import type { ComponentPropsWithoutRef } from 'react';

export function AppLink(props: ComponentPropsWithoutRef<'a'>) {
  return <a {...props} />;
}
