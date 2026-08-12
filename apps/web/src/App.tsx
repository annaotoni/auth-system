import { Button } from '@/components/ui/button';

function App() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-semibold">Auth System</h1>
        <p className="text-muted-foreground">Setup do monorepo concluído.</p>
        <Button>Tailwind + shadcn/ui ok</Button>
      </div>
    </div>
  );
}

export default App;
