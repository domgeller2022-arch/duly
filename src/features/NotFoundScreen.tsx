/**
 * The not-found screen.
 *
 * Deliberately helpful rather than apologetic: it offers the two things someone
 * who has landed here actually wants — a way back, and a way to start something.
 */

import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '@/ui/components/base';

export function NotFoundScreen() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <EmptyState
        icon={<Compass className="size-8" aria-hidden />}
        title="That page does not exist"
        hint="The link may be out of date, or the document may have been deleted. Nothing has been lost."
        action={
          <div className="flex gap-2">
            <Button onClick={() => navigate(-1)}>Go back</Button>
            <Button variant="primary" onClick={() => navigate('/')}>
              Dashboard
            </Button>
          </div>
        }
      />
    </div>
  );
}
