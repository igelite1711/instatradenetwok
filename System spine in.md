# System Spine: Real-Time B2B Payment Rails with Embedded Working Capital

## System Identity

**Name:** InstantTrade Network (ITN)  
**Core Purpose:** Universal settlement layer that makes B2B payments instant while decoupling buyer payment terms from supplier cash needs through embedded working capital.

**One-Sentence Invariant:**  
> Every invoice accepted into the network MUST result in either instant supplier payment OR explicit rejection—no pending/limbo states permitted.

---

## Inputs (with Validation Criteria)

### 1. Invoice Submission
**Input:** `Invoice(supplier_id, buyer_id, amount, terms, line_items, metadata)`

**Validation Rules:**
- `supplier_id` MUST exist in verified_suppliers table
- `buyer_id` MUST exist in verified_buyers table
- `amount` MUST be > $100 AND < $10,000,000 (per-transaction limit)
- `terms` MUST be in [0, 15, 30, 45, 60, 90] days
- `line_items` MUST sum to `amount` within $0.01 (no rounding games)
- `metadata.purchase_order_id` MUST match buyer's PO system (if required)
- Supplier account MUST NOT be frozen/suspended
- Buyer account MUST NOT be frozen/suspended
- Invoice MUST NOT be duplicate (hash of all fields checked)

**Rejection Criteria:**
- Invalid parties → reject in <100ms
- Amount out of bounds → reject in <100ms
- Duplicate detected → reject in <100ms
- Fraud score > 0.75 → reject + flag for review

### 2. Payment Term Selection (Buyer)
**Input:** `PaymentTermChoice(invoice_id, chosen_term, buyer_signature)`

**Validation Rules:**
- `chosen_term` MUST be ≤ invoice.terms (can pay early, not late)
- `buyer_signature` MUST verify via buyer's auth system
- Must occur within 48 hours of invoice submission
- Buyer credit line MUST have available capacity ≥ invoice.amount
- No conflicting pending choices for same invoice

**Rejection Criteria:**
- Timeout (>48 hours) → auto-reject, notify supplier
- Insufficient credit → reject + offer alternative terms
- Invalid signature → reject + security alert

### 3. Capital Provider Bid
**Input:** `CapitalBid(invoice_id, discount_rate, capacity, expiry_timestamp)`

**Validation Rules:**
- `discount_rate` MUST be between 0.5% and 15% annualized
- `capacity` MUST be ≥ invoice.amount
- `expiry_timestamp` MUST be > now() AND < invoice.settlement_deadline
- Capital provider MUST be licensed/verified
- Capital provider MUST have liquidity ≥ capacity

**Rejection Criteria:**
- Insufficient liquidity → reject bid
- Rate out of bounds → reject bid
- Expired bid → auto-remove from auction

### 4. Settlement Instruction
**Input:** `SettlementRequest(invoice_id, source_account, destination_account, amount)`

**Validation Rules:**
- `source_account` MUST have balance ≥ amount + fees
- `destination_account` MUST be verified (KYC/AML passed)
- `amount` MUST match invoice.amount exactly
- Settlement MUST occur within same business day as acceptance
- Both accounts MUST support instant settlement rails

**Rejection Criteria:**
- Insufficient funds → reject + rollback transaction
- Unverified account → reject + compliance alert
- Settlement rail down → queue for retry OR reject if >4 hours

---

## Guarantees (with Test Criteria)

### G1: Instant Supplier Payment
**Statement:** Once invoice accepted, supplier receives funds in ≤5 seconds.

**Test Criteria:**
```python
def test_instant_payment():
    t0 = time.now()
    invoice = submit_invoice(supplier, buyer, amount=50000)
    buyer.accept(invoice, terms=30)
    
    # Wait for settlement
    supplier_balance_before = supplier.account.balance
    wait_for_settlement(invoice.id, timeout=10)
    supplier_balance_after = supplier.account.balance
    t1 = time.now()
    
    assert supplier_balance_after == supplier_balance_before + 50000
    assert (t1 - t0) < 5  # seconds
    assert invoice.status == "SETTLED"
```

**Failure Detection:**
- Prometheus metric: `settlement_latency_seconds` > 5 → alert
- Any settlement > 10 seconds → page on-call
- 3 consecutive slow settlements → circuit breaker trips

### G2: No Double Payment
**Statement:** Every invoice settles exactly once, never zero times, never twice.

**Test Criteria:**
```python
def test_no_double_payment():
    invoice = submit_invoice(supplier, buyer, amount=50000)
    buyer.accept(invoice, terms=30)
    
    # Attempt duplicate settlement
    settlement_id_1 = ledger.get_settlement(invoice.id)
    
    # Simulate race condition: concurrent settlement attempts
    with pytest.raises(AlreadySettledError):
        force_settlement(invoice.id)
    
    # Verify exactly one ledger entry
    settlements = ledger.get_all_settlements(invoice.id)
    assert len(settlements) == 1
    assert settlements[0].amount == 50000
```

**Failure Detection:**
- Database constraint: UNIQUE(invoice_id, settlement_id)
- Ledger query: COUNT(*) WHERE invoice_id=X MUST equal 1
- Daily reconciliation: all invoices have exactly one settlement

### G3: Working Capital Transparency
**Statement:** Buyer ALWAYS knows exact cost of payment terms before acceptance.

**Test Criteria:**
```python
def test_transparent_pricing():
    invoice = submit_invoice(supplier, buyer, amount=100000)
    
    # Get pricing for different terms
    pricing_30d = get_pricing(invoice.id, terms=30)
    pricing_60d = get_pricing(invoice.id, terms=60)
    
    # Pricing must be explicit, not hidden
    assert pricing_30d.discount_rate is not None
    assert pricing_30d.total_cost == calculate_expected_cost(100000, 30, pricing_30d.discount_rate)
    
    # Buyer accepts at 60 days
    buyer.accept(invoice, terms=60)
    
    # Actual charge must match quoted price
    final_charge = ledger.get_charge(buyer.id, invoice.id)
    assert final_charge == pricing_60d.total_cost
```

**Failure Detection:**
- Any charge > quoted price → auto-refund + incident
- Pricing not shown before acceptance → transaction void
- Pricing stale (>5 min old) → re-quote required

### G4: Atomic Settlement
**Statement:** Settlement is all-or-nothing: supplier paid AND buyer charged AND capital provider funded, or entire transaction rolls back.

**Test Criteria:**
```python
def test_atomic_settlement():
    invoice = submit_invoice(supplier, buyer, amount=75000)
    buyer.accept(invoice, terms=45)
    
    # Simulate failure mid-settlement
    with mock_failure("capital_provider_transfer", at_step=2):
        with pytest.raises(SettlementFailed):
            execute_settlement(invoice.id)
    
    # Verify rollback occurred
    assert supplier.account.balance == initial_supplier_balance
    assert buyer.account.balance == initial_buyer_balance
    assert capital_provider.account.balance == initial_capital_balance
    assert invoice.status == "FAILED"
    assert ledger.get_settlement(invoice.id) is None
```

**Failure Detection:**
- 2-phase commit logs reviewed every 10 seconds
- Any orphaned transfers (one leg succeeded, other failed) → page on-call
- Daily reconciliation: sum of all supplier credits == sum of all buyer debits + capital provider advances

### G5: Fraud Detection Before Settlement
**Statement:** No settlement proceeds if fraud score > 0.75 OR if any party is on sanctions list.

**Test Criteria:**
```python
def test_fraud_prevention():
    # Create invoice with suspicious pattern
    invoice = submit_invoice(
        supplier=new_supplier_created_yesterday,
        buyer=buyer_with_many_disputes,
        amount=999999  # just under single-transaction limit
    )
    
    fraud_score = calculate_fraud_score(invoice)
    assert fraud_score > 0.75  # Triggers review
    
    # Attempt settlement
    with pytest.raises(FraudHoldException):
        buyer.accept(invoice, terms=30)
    
    # Verify invoice in review queue
    assert invoice.status == "FRAUD_REVIEW"
    assert invoice.id in fraud_review_queue
```

**Failure Detection:**
- Any settlement with fraud_score > 0.75 → system failure (should never happen)
- Daily audit: all fraud_review invoices resolved within 24 hours
- Sanctions list checked at: invoice submission, buyer acceptance, settlement execution (3 checkpoints)

### G6: Capital Provider Competition
**Statement:** For every invoice, ≥3 capital providers MUST bid OR system uses fallback rate.

**Test Criteria:**
```python
def test_capital_competition():
    invoice = submit_invoice(supplier, buyer, amount=50000)
    
    # Auction for working capital
    auction = start_auction(invoice.id, duration_seconds=10)
    bids = auction.wait_for_bids(min_bids=3, timeout=15)
    
    if len(bids) >= 3:
        # Competitive market
        winning_bid = min(bids, key=lambda b: b.discount_rate)
        assert winning_bid.discount_rate < FALLBACK_RATE
    else:
        # Use fallback rate (system provides capital)
        assert auction.final_rate == FALLBACK_RATE
    
    # Verify pricing transparency (G3)
    pricing = get_pricing(invoice.id, terms=buyer.chosen_term)
    assert pricing.discount_rate == auction.final_rate
```

**Failure Detection:**
- <3 bids received → log as low_liquidity event
- Fallback rate used >30% of time → market health degradation
- No bids at all → system cannot settle (reject invoice)

---

## Forbidden States (with Detection Methods)

### F1: Invoice in Limbo
**Forbidden:** Invoice has status NOT IN ['PENDING', 'ACCEPTED', 'SETTLED', 'REJECTED', 'FRAUD_REVIEW', 'EXPIRED']

**Detection:**
```python
def detect_limbo():
    # Query all invoices
    all_invoices = db.query("SELECT id, status FROM invoices")
    
    valid_statuses = ['PENDING', 'ACCEPTED', 'SETTLED', 'REJECTED', 'FRAUD_REVIEW', 'EXPIRED']
    limbo_invoices = [inv for inv in all_invoices if inv.status not in valid_statuses]
    
    if limbo_invoices:
        logger.critical(f"FORBIDDEN STATE: {len(limbo_invoices)} invoices in limbo")
        for inv in limbo_invoices:
            force_transition_to_safe_state(inv.id)
        raise SystemInvariantViolation("Limbo state detected")
```

**Prevention:**
- State machine enforces valid transitions only
- No direct status writes allowed (must use transition methods)
- Database CHECK constraint on status column

### F2: Partial Settlement
**Forbidden:** Supplier paid but buyer not charged (or vice versa)

**Detection:**
```python
def detect_partial_settlement():
    # Daily reconciliation
    supplier_credits = db.query("SELECT SUM(amount) FROM supplier_transfers WHERE date=today()")
    buyer_debits = db.query("SELECT SUM(amount) FROM buyer_charges WHERE date=today()")
    capital_advances = db.query("SELECT SUM(amount) FROM capital_advances WHERE date=today()")
    
    # Must balance: supplier_credits == buyer_debits + capital_advances
    total_in = buyer_debits + capital_advances
    total_out = supplier_credits
    
    if abs(total_in - total_out) > 0.01:  # Allow $0.01 rounding
        logger.critical(f"FORBIDDEN STATE: Imbalanced settlement. In={total_in}, Out={total_out}")
        raise SystemInvariantViolation("Partial settlement detected")
```

**Prevention:**
- 2-phase commit for all settlements
- Pre-commit: reserve funds in all accounts
- Commit: transfer all or rollback all
- Post-commit: verify all ledger entries match

### F3: Stale Pricing
**Forbidden:** Buyer charged based on pricing older than 5 minutes

**Detection:**
```python
def detect_stale_pricing():
    for settlement in recent_settlements:
        pricing_timestamp = settlement.pricing.timestamp
        settlement_timestamp = settlement.timestamp
        
        age_seconds = (settlement_timestamp - pricing_timestamp).total_seconds()
        
        if age_seconds > 300:  # 5 minutes
            logger.error(f"FORBIDDEN STATE: Stale pricing used. Age={age_seconds}s")
            # Auto-refund difference if rate changed
            current_rate = get_current_rate(settlement.invoice_id)
            if current_rate < settlement.pricing.discount_rate:
                refund_amount = calculate_refund(settlement, current_rate)
                issue_refund(settlement.buyer_id, refund_amount)
            raise SystemInvariantViolation("Stale pricing detected")
```

**Prevention:**
- Pricing quotes have expiry_timestamp
- Settlement checks pricing.expiry_timestamp > now()
- If expired, re-quote before settlement

### F4: Frozen Account Transacting
**Forbidden:** Any transfer involving a frozen/suspended account

**Detection:**
```python
def detect_frozen_account_activity():
    frozen_accounts = db.query("SELECT id FROM accounts WHERE status='FROZEN'")
    
    # Check recent transactions
    for account_id in frozen_accounts:
        recent_activity = ledger.get_activity(account_id, since=now() - timedelta(hours=1))
        
        if recent_activity:
            logger.critical(f"FORBIDDEN STATE: Frozen account {account_id} has activity")
            # Rollback all transactions
            for txn in recent_activity:
                rollback_transaction(txn.id)
            raise SystemInvariantViolation("Frozen account transacted")
```

**Prevention:**
- Pre-transaction check: account.status MUST be 'ACTIVE'
- Account freeze triggers immediate circuit breaker (no new txns)
- Background job: every 10s, verify no frozen accounts in pending transactions

### F5: Credit Limit Exceeded
**Forbidden:** Buyer has outstanding balance > approved credit limit

**Detection:**
```python
def detect_credit_limit_breach():
    for buyer in all_buyers:
        outstanding = calculate_outstanding_balance(buyer.id)
        credit_limit = buyer.credit_limit
        
        if outstanding > credit_limit:
            logger.error(f"FORBIDDEN STATE: Buyer {buyer.id} over limit. Outstanding={outstanding}, Limit={credit_limit}")
            
            # Freeze new transactions
            buyer.status = 'CREDIT_HOLD'
            
            # Notify risk team
            notify_risk_team(buyer.id, outstanding, credit_limit)
            
            raise SystemInvariantViolation("Credit limit exceeded")
```

**Prevention:**
- Pre-acceptance check: buyer.available_credit >= invoice.amount
- Real-time credit utilization tracking
- Credit limit updates require dual approval

### F6: Orphaned Capital Advance
**Forbidden:** Capital provider funded but settlement failed (money stuck)

**Detection:**
```python
def detect_orphaned_capital():
    # Find capital advances without corresponding settlements
    orphaned = db.query("""
        SELECT ca.id, ca.amount, ca.timestamp
        FROM capital_advances ca
        LEFT JOIN settlements s ON ca.invoice_id = s.invoice_id
        WHERE s.id IS NULL
        AND ca.timestamp < NOW() - INTERVAL '1 hour'
    """)
    
    if orphaned:
        logger.critical(f"FORBIDDEN STATE: {len(orphaned)} orphaned capital advances")
        
        # Auto-recovery: return funds to capital provider
        for advance in orphaned:
            return_funds_to_capital_provider(advance.id)
            mark_invoice_as_failed(advance.invoice_id)
        
        raise SystemInvariantViolation("Orphaned capital detected")
```

**Prevention:**
- Capital advance is final step in 2-phase commit
- If any prior step fails, capital provider never funds
- Hourly sweep: any capital advance >1 hour old without settlement → auto-return

---

## Evolution Principles (with Invariant Preservation Proofs)

### E1: Multi-Currency Support
**Change:** Add support for EUR, GBP, JPY (currently USD-only)

**Invariants Preserved:**
- G1 (Instant Payment): Currency doesn't affect settlement speed
- G2 (No Double Payment): Invoice uniqueness includes currency field
- G4 (Atomic Settlement): 2-phase commit works across currencies

**New Invariants Added:**
- Exchange rates must be <60s old at settlement time
- All parties must agree on currency before invoice submission
- FX provider must guarantee rates at time of acceptance (not settlement)

**Proof of Safety:**
```python
# Before: USD-only
invoice = Invoice(amount=100000, currency="USD")

# After: Multi-currency
invoice = Invoice(amount=100000, currency="EUR", fx_rate=1.08, fx_timestamp=now())

# Invariant G1 still holds:
# - Settlement speed independent of currency
# - FX conversion happens pre-settlement (not during)
# - If FX provider fails, entire transaction rolls back (G4)

# Invariant G2 still holds:
# - Invoice hash includes currency field
# - Cannot submit same invoice in different currency
```

### E2: Recurring Invoices
**Change:** Support subscriptions (monthly recurring invoices)

**Invariants Preserved:**
- G1 (Instant Payment): Each occurrence settles instantly
- G2 (No Double Payment): Each occurrence is separate invoice
- G5 (Fraud Detection): Each occurrence re-checks fraud score

**New Invariants Added:**
- Recurring template MUST have end date OR max occurrences
- Each occurrence generated ≤24 hours before due date
- Buyer can cancel anytime (future occurrences only)

**Proof of Safety:**
```python
# Recurring template
template = RecurringInvoice(
    supplier_id=supplier,
    buyer_id=buyer,
    amount=5000,
    frequency="MONTHLY",
    max_occurrences=12
)

# Each occurrence is a new invoice
for month in range(12):
    invoice = generate_from_template(template, occurrence=month)
    
    # Invariant G1: Each invoice settles instantly (independent)
    assert settlement_time(invoice) < 5
    
    # Invariant G2: Each invoice is unique
    assert invoice.id != previous_invoice.id
    
    # Invariant G5: Each invoice re-checked for fraud
    assert fraud_score_calculated_at(invoice.id) > invoice.created_at
```

### E3: Smart Routing (Multi-Path Settlement)
**Change:** Route through fastest available settlement rail (ACH, RTP, FedNow, SWIFT)

**Invariants Preserved:**
- G1 (Instant Payment): Routes prioritized by speed; fallback if primary fails
- G4 (Atomic Settlement): All rails support 2-phase commit
- G2 (No Double Payment): Settlement ID unique across all rails

**New Invariants Added:**
- If primary rail fails, must try secondary within 10 seconds
- All rails must confirm settlement before marking invoice complete
- Rail downtime detected within 30 seconds

**Proof of Safety:**
```python
# Settlement routing
def execute_settlement(invoice_id):
    rails = [RTP, FedNow, ACH]  # Ordered by speed
    
    for rail in rails:
        if rail.is_available():
            try:
                result = rail.settle(invoice_id)
                
                # Invariant G1: Still instant (first rail is fastest)
                assert result.duration < 5
                
                # Invariant G4: Atomic across all legs
                assert result.all_legs_confirmed()
                
                return result
            except RailException:
                logger.warning(f"{rail} failed, trying next rail")
                continue
    
    # All rails failed
    raise SettlementFailed("No available rails")
```

### E4: Partial Invoice Payments
**Change:** Allow buyers to pay invoices in installments

**Invariants AT RISK:**
- G2 (No Double Payment): Now have multiple payments per invoice
- G4 (Atomic Settlement): Cannot roll back partial payments

**Resolution:**
- REJECT this evolution - breaks core invariant
- Alternative: Create sub-invoices (each atomic)

**Proof of Incompatibility:**
```python
# Proposed change
invoice = Invoice(amount=100000)
buyer.pay_partial(invoice, amount=30000)  # First installment
buyer.pay_partial(invoice, amount=70000)  # Second installment

# PROBLEM: Violates G2 (No Double Payment)
# - Invoice has 2 settlements now
# - If second payment fails, first payment cannot roll back
# - Supplier has $30k but invoice not "complete"

# FORBIDDEN STATE: Partial settlement (F2)

# CORRECT APPROACH: Split into sub-invoices
invoice_1 = Invoice(amount=30000, parent_id=original_invoice.id)
invoice_2 = Invoice(amount=70000, parent_id=original_invoice.id)

# Each sub-invoice settles atomically (G4 preserved)
# No double payment (each invoice settles exactly once)
```

### E5: Escrow Accounts
**Change:** Hold funds in escrow until delivery confirmed

**Invariants AT RISK:**
- G1 (Instant Payment): Supplier doesn't get paid instantly anymore

**Resolution:**
- This changes core value proposition - requires new spine
- If pursued, create separate product: "TradeGuard" (escrow service)
- InstantTrade remains instant; TradeGuard adds delivery guarantees

**Proof of Core Value Preservation:**
```python
# InstantTrade: Supplier paid instantly
invoice = submit_invoice(supplier, buyer, amount=50000)
buyer.accept(invoice)
assert supplier.balance_at(t=5_seconds) == initial_balance + 50000

# TradeGuard: Supplier paid on delivery (DIFFERENT PRODUCT)
escrow = create_escrow(supplier, buyer, amount=50000)
buyer.fund_escrow(escrow)
deliver_goods(escrow)
confirm_delivery(escrow)  # Could be days later
supplier.receive_from_escrow(escrow)

# Lesson: Don't dilute core invariant (G1)
# Create separate product if value proposition changes
```

---

## Conflict Analysis

### Conflict 1: Speed vs. Fraud Prevention
**Tension:** G1 (Instant Payment <5s) vs. G5 (Fraud Detection)

**Resolution:**
- Fraud checks are pre-computed (asynchronous)
- At invoice submission: calculate fraud score (can take minutes)
- At buyer acceptance: fraud score must already exist
- If score >0.75, invoice rejected before settlement starts

**Trade-off:**
- Invoice submission → acceptance has 48-hour window
- Use this window for fraud analysis
- Settlement (acceptance → paid) remains <5s

**Test:**
```python
def test_no_conflict_speed_vs_fraud():
    t0 = time.now()
    invoice = submit_invoice(supplier, buyer, amount=50000)
    
    # Fraud analysis happens asynchronously
    wait_for_fraud_score(invoice.id, timeout=300)  # Up to 5 minutes
    
    # 24 hours later, buyer accepts
    time.sleep(24 * 3600)
    
    # Settlement still instant
    t1 = time.now()
    buyer.accept(invoice, terms=30)
    t2 = time.now()
    
    assert (t2 - t1) < 5  # Instant settlement preserved
    assert invoice.fraud_score is not None  # Fraud check completed
```

### Conflict 2: Transparency vs. Market Efficiency
**Tension:** G3 (Show exact cost before acceptance) vs. E6 (Dynamic pricing based on market)

**Resolution:**
- Pricing quotes valid for 5 minutes
- If market moves significantly, buyer gets new quote
- Buyer cannot accept stale quote (F3 prevents this)

**Trade-off:**
- Volatile markets require frequent re-quotes
- Buyers may see prices change while reviewing
- System prioritizes transparency over convenience

**Test:**
```python
def test_no_conflict_transparency_vs_dynamic_pricing():
    invoice = submit_invoice(supplier, buyer, amount=100000)
    
    # Get initial quote
    quote_1 = get_pricing(invoice.id, terms=30)
    assert quote_1.discount_rate == 6.5  # Market rate at t0
    
    # Market moves (capital providers change bids)
    time.sleep(360)  # 6 minutes
    
    # Buyer tries to accept at old rate
    with pytest.raises(StalePricingError):
        buyer.accept_with_pricing(invoice, quote_1)
    
    # Buyer must get new quote
    quote_2 = get_pricing(invoice.id, terms=30)
    assert quote_2.discount_rate == 7.2  # Market moved
    
    # Acceptance succeeds with fresh quote
    buyer.accept_with_pricing(invoice, quote_2)
    
    # Charge matches quoted rate (transparency preserved)
    assert ledger.get_charge(buyer.id, invoice.id) == calculate_cost(100000, 30, 7.2)
```

### Conflict 3: Instant Settlement vs. Regulatory Holds
**Tension:** G1 (<5s payment) vs. AML regulations (may require holds)

**Resolution:**
- KYC/AML checks done at account creation, not per-transaction
- If new risk detected mid-transaction, settlement blocked (not delayed)
- No "pending review" state - either instant success or instant rejection

**Trade-off:**
- Stricter onboarding (may take days to verify new accounts)
- Once onboarded, transactions are instant
- System prioritizes transactional velocity over onboarding speed

**Test:**
```python
def test_no_conflict_instant_vs_compliance():
    # Scenario 1: Clean transaction
    invoice = submit_invoice(verified_supplier, verified_buyer, amount=50000)
    buyer.accept(invoice)
    assert settlement_time(invoice) < 5  # Instant
    
    # Scenario 2: Suspicious transaction
    invoice_2 = submit_invoice(new_supplier, buyer_on_watchlist, amount=999999)
    
    # Blocked immediately (not delayed)
    with pytest.raises(ComplianceHold):
        buyer.accept(invoice_2)
    
    # Status is REJECTED, not PENDING_REVIEW
    assert invoice_2.status == "REJECTED"
    assert invoice_2.rejection_reason == "COMPLIANCE_HOLD"
    
    # No money moved (G4: atomic)
    assert supplier.balance == initial_balance
```

---

## Verification Windows (Assumption Decay)

| Assumption | Verification Window | Revalidation Method |
|------------|---------------------|---------------------|
| Fraud score | 24 hours | Recalculate on buyer acceptance |
| Credit limit | 1 hour | Query credit system before each transaction |
| FX rate | 60 seconds | Fetch new rate if >60s old |
| Pricing quote | 5 minutes | Re-run auction if quote expired |
| Account status | 10 seconds | Check account.status in database |
| Capital provider liquidity | 30 seconds | Ping capital provider API |
| Settlement rail health | 30 seconds | Health check every rail |
| Sanctions list | 6 hours | Download updated list from OFAC |
| Buyer's bank account link | 7 days | Re-verify micro-deposits |
| Supplier's routing info | 30 days | Send test transfer |

**Decay Enforcement Example:**
```python
class ExpiringFraudScore:
    def __init__(self, invoice_id):
        self.invoice_id = invoice_id
        self.score = None
        self.calculated_at = None
        self.verification_window = timedelta(hours=24)
    
    def get(self) -> float:
        age = now() - self.calculated_at if self.calculated_at else timedelta.max
        
        if age > self.verification_window:
            # Score expired, recalculate
            logger.warning(f"Fraud score expired for invoice {self.invoice_id}")
            self.score = calculate_fraud_score(self.invoice_id)
            self.calculated_at = now()
        
        return self.score
```

---

## System Constraints

### Scale Limits
- **Throughput:** 10,000 settlements/second (99th percentile <5s)
- **Invoice size:** $100 - $10,000,000 per transaction
- **Daily volume per buyer:** $50,000,000
- **Daily volume per supplier:** Unlimited
- **Capital provider liquidity:** ≥$100M to participate

### Performance Limits
- **Settlement latency:** <5 seconds (99.9th percentile)
- **Fraud check latency:** <5 minutes (async, before acceptance)
- **Pricing quote generation:** <500ms
- **Database queries:** <100ms (99th percentile)
- **API response time:** <200ms (95th percentile)

### Operational Constraints
- **Uptime SLA:** 99.95% (21.6 minutes downtime/month)
- **Data retention:** 7 years (regulatory requirement)
- **Audit trail immutability:** Cryptographic signing, blockchain-anchored
- **Geographic availability:** US-only initially (expand to EU by 2027)
- **Disaster recovery:** RPO <1 minute, RTO <15 minutes

---

## Risk Surfaces

### Financial Risks
1. **Credit risk:** Buyer defaults before paying capital provider
   - Mitigation: Credit underwriting, real-time limit monitoring
2. **Liquidity risk:** Not enough capital providers bid on invoice
   - Mitigation: Fallback rate, system provides capital if needed
3. **FX risk:** Currency moves between quote and settlement
   - Mitigation: 60-second quote expiry, hedging via FX providers

### Operational Risks
1. **Settlement rail failure:** Primary rail goes down mid-transaction
   - Mitigation: Multi-rail routing, automatic failover
2. **Capital provider insolvency:** Provider defaults mid-advance
   - Mitigation: Capital provider reserve requirements, insurance
3. **Database corruption:** Ledger integrity compromised
   - Mitigation: Immutable ledger, cryptographic signatures, daily reconciliation

### Security Risks
1. **Account takeover:** Attacker gains control of buyer/supplier account
   - Mitigation: 2FA, device fingerprinting, transaction velocity limits
2. **Invoice fraud:** Fake invoices submitted
   - Mitigation: PO matching, supplier verification, fraud scoring
3. **Insider attack:** Employee manipulates transactions
   - Mitigation: Dual approval for high-value transactions, audit logs

### Regulatory Risks
1. **AML violation:** Transaction used for money laundering
   - Mitigation: Transaction monitoring, sanctions screening, SAR filing
2. **Data breach:** Customer data exposed
   - Mitigation: Encryption at rest/transit, access controls, SOC 2 compliance
3. **Licensing:** Operating without money transmitter license
   - Mitigation: State-by-state licensing, partnership with licensed banks

---

## Hidden Dependencies

### External Systems
1. **Banking rails:** RTP, FedNow, ACH (settlement infrastructure)
2. **Credit bureaus:** Experian, Equifax (credit underwriting)
3. **Fraud services:** Sift, Stripe Radar (fraud detection)
4. **FX providers:** Wise, OFX (currency conversion)
5. **Identity verification:** Plaid, Alloy (KYC/AML)
6. **Sanctions lists:** OFAC (compliance)

### Internal Assumptions
1. **Database ACID:** PostgreSQL transactions guarantee atomicity
2. **Clock synchronization:** All servers within 100ms of NTP
3. **Network partitions:** Handled by 2-phase commit timeout (10s)
4. **Message queue ordering:** Kafka guarantees order within partition

---

## Constitutional Validation

### ✅ Every input has validation criteria
- Invoice submission: 8 validation rules
- Payment term selection: 5 validation rules
- Capital bid: 5 validation rules
- Settlement instruction: 5 validation rules

### ✅ Every guarantee is testable
- G1: `assert settlement_time < 5`
- G2: `assert len(settlements) == 1`
- G3: `assert final_charge == quoted_price`
- G4: `assert all_legs_confirmed() or all_rolled_back()`
- G5: `assert fraud_score < 0.75`
- G6: `assert len(bids) >= 3 or rate == FALLBACK_RATE`

### ✅ Every forbidden state is detectable
- F1 (Limbo): Query invalid statuses
- F2 (Partial settlement): Daily reconciliation
- F3 (Stale pricing): Check pricing.timestamp
- F4 (Frozen account): Check account.status
- F5 (Credit limit): Calculate outstanding balance
- F6 (Orphaned capital): LEFT JOIN query

### ✅ Evolution paths preserve core invariants
- Multi-currency: Preserves G1, G2, G4
- Recurring invoices: Preserves all guarantees
- Smart routing: Preserves G1, G2, G4
- Partial payments: **REJECTED** (breaks G2, G4)
- Escrow: Requires separate product (breaks G1)

### ✅ All constraints are non-conflicting
- Speed vs. Fraud: Async fraud checks (no conflict)
- Transparency vs. Dynamic pricing: 5-min quote expiry (no conflict)
- Instant settlement vs. Compliance: Reject instantly (no conflict)

---

## Health Score Calculation

```python
def calculate_system_health() -> float:
    """
    Returns 0.0 (critical failure) to 1.0 (perfect health).
    Threshold for operation: ≥0.95
    """
    
    # Critical metrics (must all pass)
    critical = [
        settlement_latency_p99 < 5,  # G1
        double_payment_rate == 0,  # G2
        pricing_accuracy == 1.0,  # G3
        atomic_settlement_rate == 1.0,  # G4
        fraud_block_rate == 1.0,  # G5 (all >0.75 blocked)
    ]
    
    if not all(critical):
        return 0.0  # Critical failure
    
    # Important metrics (degraded but operational)
    important = [
        capital_competition_rate > 0.7,  # G6: ≥3 bids 70% of time
        settlement_rail_uptime > 0.995,  # Operational constraint
        fraud_check_latency < 300,  # 5 minutes
    ]
    
    # Optional metrics (nice to have)
    optional = [
        api_latency_p95 < 200,  # Performance goal
        daily_volume_growth > 0,  # Business metric
    ]
    
    # Weighted score
    critical_weight = 0.7
    important_weight = 0.2
    optional_weight = 0.1
    
    score = (
        critical_weight * (sum(critical) / len(critical)) +
        important_weight * (sum(important) / len(important)) +
        optional_weight * (sum(optional) / len(optional))
    )
    
    return score
```

---

**System Spine Status:** READY FOR DESIGN_LOCK  
**Conflicts:** 0 unresolved  
**Testability:** 100% (all guarantees have test criteria)  
**Enforcement:** 100% (all forbidden states detectable)  
**Evolution Safety:** Proven for 4/5 proposals (1 rejected correctly)