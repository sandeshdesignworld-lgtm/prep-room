import { AlertCircle } from 'lucide-react';
import Card from '@/components/ui/Card';

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-page">
      <Card className="w-full max-w-md mx-4 p-6">
        <div className="flex mb-4 gap-2">
          <AlertCircle className="h-8 w-8 text-red" />
          <h1 className="text-2xl font-bold text-ink">
            404 Page Not Found
          </h1>
        </div>

        <p className="mt-4 text-sm text-ink-2">
          Did you forget to add the page to the router?
        </p>
      </Card>
    </div>
  );
}
