import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                InstantTrade Network
              </h1>
              <p className="mt-2 text-slate-600">
                Real-time B2B payment settlement with embedded working capital
              </p>
            </div>
            <Badge variant="outline" className="text-base">
              Phase 1: Live
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* System Status */}
        <div className="mb-8 grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Settlement Status</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">99.9%</div>
              <p className="text-xs text-slate-600">Success Rate (7-day)</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Settlement</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">2.3s</div>
              <p className="text-xs text-slate-600">Average Settlement Time</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Invoices</CardTitle>
              <AlertCircle className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">1,247</div>
              <p className="text-xs text-slate-600">Pending Settlement</p>
            </CardContent>
          </Card>
        </div>

        {/* Core Guarantees */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Core System Guarantees</CardTitle>
            <CardDescription>
              The ITN system enforces 6 critical guarantees through invariant-based design
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold">G1: Instant Supplier Payment</h3>
                  <p className="text-sm text-slate-600">
                    Suppliers receive funds within ≤5 seconds of buyer acceptance
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold">G2: No Double Payment</h3>
                  <p className="text-sm text-slate-600">
                    Every invoice settles exactly once—never zero, never twice
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold">G3: Pricing Transparency</h3>
                  <p className="text-sm text-slate-600">
                    Buyers know exact working capital costs before acceptance
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold">G4: Atomic Settlement</h3>
                  <p className="text-sm text-slate-600">
                    All-or-nothing: complete settlement or entire transaction rolls back
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold">G5: Fraud Prevention</h3>
                  <p className="text-sm text-slate-600">
                    No settlements above fraud threshold or with sanctioned parties
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold">G6: Capital Competition</h3>
                  <p className="text-sm text-slate-600">
                    ≥3 capital providers bid for working capital to ensure competitive rates
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Key Components */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Processing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                • Unique invoice ID validation (INV-001)
              </p>
              <p>
                • Amount range checks: $100 - $10M (INV-002)
              </p>
              <p>
                • Active account verification (INV-003)
              </p>
              <p>
                • Duplicate hash detection (INV-004)
              </p>
              <p>
                • Credit limit enforcement (INV-005)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settlement Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                • Valid state transitions (INV-101)
              </p>
              <p>
                • Atomic 2-phase commit (INV-102)
              </p>
              <p>
                • Pricing verification (INV-103)
              </p>
              <p>
                • Authorization checks (INV-104)
              </p>
              <p>
                • Immutable terminal states (INV-105)
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-slate-600">
            Design Locked • Phase 1: Invariant Definition • All systems operational
          </p>
        </div>
      </footer>
    </main>
  );
}
