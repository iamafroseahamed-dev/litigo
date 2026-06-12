import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Scale, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

const DEMO_ACCOUNTS = [
  { email: 'admin@chennailegalsolutions.com', org: 'Chennai Legal Solutions' },
  { email: 'admin@madurailegal.com', org: 'Madurai Legal Associates' },
  { email: 'admin@southlawassociates.com', org: 'South Law Associates' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter both email and password');
      return;
    }
    setLoading(true);
    try {
      await login({ email, password });
      navigate('/dashboard');
      toast.success('Welcome back!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Demo@123');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-3 sm:p-4">
      <div className="w-full max-w-md space-y-5 sm:space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="mb-2 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg sm:h-16 sm:w-16">
            <Scale className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Legal Case Alert</h1>
          <p className="text-blue-200 text-sm">Court Cause List Management & Alert System</p>
        </div>

        {/* Login Card */}
        <Card className="border-0 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle>Sign In</CardTitle>
            <CardDescription>Enter your organization credentials to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@yourfirm.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="h-11 w-full" loading={loading}>
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo Accounts */}
        <Card className="border border-blue-500/30 bg-blue-950/50 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-blue-200">Demo Accounts (Password: Demo@123)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEMO_ACCOUNTS.map(({ email: demoEmail, org }) => (
              <button
                key={demoEmail}
                type="button"
                onClick={() => fillDemo(demoEmail)}
                className="w-full rounded-md border border-blue-700/30 bg-blue-900/50 px-3 py-2.5 text-left text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
              >
                <div className="font-medium">{org}</div>
                <div className="text-blue-300/80 mt-0.5">{demoEmail}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-blue-300/60">
          Phase 1 Demo Mode — Real eCourts API & notification integrations pending
        </p>
      </div>
    </div>
  );
}
