import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Smartphone, MessageSquare, Camera, QrCode, Building2, Users as UsersIcon, Bell, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">System brain · users, integrations, garage configuration</p>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="flex-wrap">
          <TabsTrigger value="users">Users & Roles</TabsTrigger>
          <TabsTrigger value="garage">Garage Setup</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="branches">Multi-Branch</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <UsersIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">Team members</h3>
                <p className="text-sm text-muted-foreground mt-1">User management has moved to its own page so you only see staff you've actually created.</p>
                <Button asChild size="sm" className="mt-3 bg-gradient-primary">
                  <Link to="/users">Open User Management <ArrowRight className="h-4 w-4 ml-2" /></Link>
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="garage" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-4">
            <h3 className="font-semibold">Garage configuration</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Garage name</Label><Input defaultValue="Golden Automotive Solutions" /></div>
              <div><Label>Labor rate (KSh / hr)</Label><Input type="number" defaultValue={1500} /></div>
              <div><Label>VAT (%)</Label><Input type="number" defaultValue={16} /></div>
              <div><Label>Currency</Label><Input defaultValue="KSh" /></div>
              <div className="md:col-span-2"><Label>Invoice footer</Label><Input defaultValue="Thank you for trusting Golden Automotive Solutions." /></div>
            </div>
            <div className="flex justify-end"><Button className="bg-gradient-primary">Save changes</Button></div>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationCard icon={Smartphone} name="M-Pesa Daraja API" desc="Accept STK push payments on invoices" status="Configure" />
            <IntegrationCard icon={MessageSquare} name="WhatsApp Business" desc="Customer approvals & service reminders" status="Configure" />
            <IntegrationCard icon={Camera} name="ANPR Camera" desc="Auto-detect plates at gate entry" status="Connected" connected />
            <IntegrationCard icon={QrCode} name="Barcode / QR scanner" desc="Scan parts & generate gate passes" status="Connected" connected />
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Bell className="h-4 w-4 text-primary" />Alert preferences</h3>
            {[
              { label: "Low stock alerts", desc: "Notify storekeeper & admin when below min" },
              { label: "Job delay alerts", desc: "Flag jobs running over estimated time" },
              { label: "Service due reminders", desc: "Auto-SMS customers based on mileage / date" },
              { label: "Suspicious activity", desc: "Parts issued without job, missing tools" },
            ].map(n => (
              <div key={n.label} className="flex items-center justify-between border-b last:border-0 py-3">
                <div>
                  <p className="font-medium text-sm">{n.label}</p>
                  <p className="text-xs text-muted-foreground">{n.desc}</p>
                </div>
                <Switch defaultChecked />
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="branches" className="mt-4">
          <Card className="p-6 max-w-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Building2 className="h-5 w-5" /></div>
              <div>
                <h3 className="font-semibold">Multi-branch (coming soon)</h3>
                <p className="text-xs text-muted-foreground">Manage stock & jobs across multiple garage locations</p>
              </div>
            </div>
            <Button variant="outline" disabled>Add branch</Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IntegrationCard({ icon: Icon, name, desc, status, connected }: { icon: React.ElementType; name: string; desc: string; status: string; connected?: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className={`h-11 w-11 rounded-lg flex items-center justify-center ${connected ? "bg-success/10 text-success" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">{name}</h4>
            {connected && <Badge className="bg-success text-success-foreground text-[10px]">Connected</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{desc}</p>
          <Button variant={connected ? "outline" : "default"} size="sm" className={`mt-3 ${!connected ? "bg-gradient-primary" : ""}`}>{status}</Button>
        </div>
      </div>
    </Card>
  );
}
