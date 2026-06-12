import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Building2, Globe, MessageCircle, Mail, Bell, Info, ShieldCheck } from 'lucide-react';

function DemoNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 mt-3">
      <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function PlaceholderInput({ label, placeholder, type = 'text', hint }: {
  label: string; placeholder: string; type?: string; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        {label}
        <Badge variant="warning" className="text-xs py-0">Placeholder</Badge>
      </Label>
      <Input type={type} placeholder={placeholder} disabled className="bg-muted/50 cursor-not-allowed" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [orgName, setOrgName] = useState(user?.organization.organization_name ?? '');
  const [contactPerson, setContactPerson] = useState(user?.organization.contact_person ?? '');
  const [orgEmail, setOrgEmail] = useState(user?.organization.email ?? '');
  const [orgMobile, setOrgMobile] = useState(user?.organization.mobile ?? '');
  const [notifWhatsApp, setNotifWhatsApp] = useState(true);
  const [notifSMS, setNotifSMS] = useState(true);
  const [notifEmail, setNotifEmail] = useState(true);
  const [msgTemplate, setMsgTemplate] = useState(
    `{OrgName}\n\nDear {ClientName},\n\nYour case has been listed today.\n\nCase No: {CaseNumber}\nCourt: {CourtName}\nBench: {Bench}\nJudge: {JudgeName}\nCourt Hall: {CourtNo}\nSerial No: {ListingNo}\nDate: {HearingDate}\nAdvocate: {AdvocateName}\n\nPlease contact our office for further instructions.\n\n{OrgName}`
  );

  const saveOrg = () => toast.success('Organization profile saved (demo).');

  return (
    <div className="max-w-4xl space-y-6">
      <Tabs defaultValue="organization">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex h-auto min-w-[640px] items-stretch justify-start gap-1">
            <TabsTrigger value="organization" className="text-xs">Organization</TabsTrigger>
            <TabsTrigger value="ecourts" className="text-xs">eCourts API</TabsTrigger>
            <TabsTrigger value="twilio" className="text-xs">Twilio</TabsTrigger>
            <TabsTrigger value="smtp" className="text-xs">SMTP / Email</TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs">Preferences</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Organization ────────────────────────────────────── */}
        <TabsContent value="organization">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4" /> Organization Profile
              </CardTitle>
              <CardDescription>Update your organization's contact information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Organization Name</Label>
                  <Input value={orgName} onChange={e => setOrgName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact Person</Label>
                  <Input value={contactPerson} onChange={e => setContactPerson(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={orgEmail} onChange={e => setOrgEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Mobile</Label>
                  <Input value={orgMobile} onChange={e => setOrgMobile(e.target.value)} />
                </div>
              </div>
              <div className="pt-2">
                <Button onClick={saveOrg}>Save Profile</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── eCourts API ─────────────────────────────────────── */}
        <TabsContent value="ecourts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="w-4 h-4" /> eCourts API Integration
                <Badge variant="warning" className="text-xs">Demo Mode</Badge>
              </CardTitle>
              <CardDescription>
                Configure eCourts API credentials for real cause list sync.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DemoNote message="eCourts API integration is currently in demo mode. Real credentials can be configured later." />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PlaceholderInput
                  label="eCourts API Base URL"
                  placeholder="https://api.ecourts.gov.in"
                  hint="Base URL provided by eCourts partner program"
                />
                <PlaceholderInput
                  label="eCourts API Key"
                  type="password"
                  placeholder="Your API key (kept secret)"
                  hint="Never expose this key in the frontend"
                />
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input defaultValue="TN" disabled className="bg-muted/50" />
                </div>
                <div className="space-y-1.5">
                  <Label>Court</Label>
                  <Input defaultValue="Madras High Court" disabled className="bg-muted/50" />
                </div>
                <div className="space-y-1.5">
                  <Label>Bench</Label>
                  <Input defaultValue="Chennai / Madurai" disabled className="bg-muted/50" />
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 mt-2 text-xs text-muted-foreground">
                <p className="font-semibold mb-1">Future API Endpoint</p>
                <code className="block bg-background p-2 rounded border text-xs">
                  GET /api/partner/causelist/search?date=today&state=TN&court=Madras+High+Court&bench=Chennai
                </code>
              </div>
              <Button disabled variant="outline">Save Credentials (Available Soon)</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Twilio ──────────────────────────────────────────── */}
        <TabsContent value="twilio">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="w-4 h-4" /> Twilio (WhatsApp + SMS)
                <Badge variant="warning" className="text-xs">Demo Mode</Badge>
              </CardTitle>
              <CardDescription>
                Configure Twilio credentials to send real WhatsApp and SMS alerts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DemoNote message="Notification integrations are currently in demo mode. Real credentials can be configured later." />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PlaceholderInput label="Twilio Account SID" placeholder="ACxxxxxxxxxxxxxxxx" hint="From Twilio Console" />
                <PlaceholderInput label="Twilio Auth Token" type="password" placeholder="••••••••••••••••" hint="Keep this secret" />
                <PlaceholderInput label="WhatsApp Number" placeholder="whatsapp:+14155238886" hint="Twilio WhatsApp sender" />
                <PlaceholderInput label="SMS Number" placeholder="+14155238887" hint="Twilio SMS sender" />
              </div>
              <Button disabled variant="outline">Save Twilio Config (Available Soon)</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SMTP ────────────────────────────────────────────── */}
        <TabsContent value="smtp">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="w-4 h-4" /> SMTP / Email
                <Badge variant="warning" className="text-xs">Demo Mode</Badge>
              </CardTitle>
              <CardDescription>
                Configure SMTP settings to send real email notifications.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DemoNote message="Email integration is currently in demo mode. Real SMTP credentials can be configured later." />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PlaceholderInput label="SMTP Host" placeholder="smtp.gmail.com" />
                <PlaceholderInput label="SMTP Port" placeholder="587" hint="TLS: 587, SSL: 465" />
                <PlaceholderInput label="SMTP Username" placeholder="your@email.com" />
                <PlaceholderInput label="SMTP Password" type="password" placeholder="••••••••" />
                <PlaceholderInput label="From Address" placeholder="alerts@yourfirm.com" />
                <PlaceholderInput label="From Name" placeholder="Chennai Legal Solutions" />
              </div>
              <Button disabled variant="outline">Save SMTP Config (Available Soon)</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notification Preferences ────────────────────────── */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="w-4 h-4" /> Notification Preferences
              </CardTitle>
              <CardDescription>
                Control which notification channels are active and customize message templates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <p className="text-sm font-semibold">Active Channels</p>
                {[
                  { label: 'WhatsApp Notifications', value: notifWhatsApp, set: setNotifWhatsApp },
                  { label: 'SMS Notifications', value: notifSMS, set: setNotifSMS },
                  { label: 'Email Notifications', value: notifEmail, set: setNotifEmail },
                ].map(({ label, value, set }) => (
                  <div key={label} className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="cursor-pointer">{label}</Label>
                    <Switch checked={value} onCheckedChange={set} />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Message Template</Label>
                <Textarea
                  value={msgTemplate}
                  onChange={e => setMsgTemplate(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Available variables: {'{OrgName}'}, {'{ClientName}'}, {'{CaseNumber}'}, {'{CourtName}'}, {'{Bench}'}, {'{JudgeName}'}, {'{CourtNo}'}, {'{ListingNo}'}, {'{HearingDate}'}, {'{AdvocateName}'}
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted p-3 rounded-lg">
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                <span>API keys and credentials are stored securely. They are never exposed in client-side code or logs.</span>
              </div>

              <Button onClick={() => toast.success('Notification preferences saved (demo).')}>
                Save Preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
