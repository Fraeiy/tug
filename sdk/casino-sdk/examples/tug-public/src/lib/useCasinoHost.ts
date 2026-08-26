import { useEffect, useState } from 'react';
import {
  connectGameToHost,
  observeGameContentSize,
  type GuestApiV1,
  type HostApiV1,
  type HostSnapshotV1,
} from '@chain/casino-sdk/guest';
import { createDemoHost, isEmbedded, wantsDemoMode } from './demoHost';

const HOST_TIMEOUT_MS = 1800;

/**
 * Guest bridge. Prefers the real host; falls back to gated demo mode so the
 * page stays playable standalone (jam eligibility).
 */
export function useCasinoHost(): {
  hostApi: HostApiV1 | null;
  snapshot: HostSnapshotV1 | null;
  demoMode: boolean;
} {
  const [hostApi, setHostApi] = useState<HostApiV1 | null>(null);
  const [snapshot, setSnapshot] = useState<HostSnapshotV1 | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    let mounted = true;
    let settled = false;
    let demoUnsub: (() => void) | null = null;

    const startDemo = () => {
      if (!mounted || settled) return;
      settled = true;
      const demo = createDemoHost();
      setDemoMode(true);
      setHostApi(demo.hostApi);
      demoUnsub = demo.subscribe(next => {
        if (mounted) setSnapshot(next);
      });
    };

    if (wantsDemoMode()) {
      startDemo();
      return () => {
        mounted = false;
        demoUnsub?.();
      };
    }

    const guestMethods: GuestApiV1 = {
      async setState(nextSnapshot) {
        if (!mounted) return;
        setSnapshot(nextSnapshot);
      },
    };

    const connection = connectGameToHost(guestMethods);

    const timeout = window.setTimeout(() => {
      // Standalone tab with no host — enable demo so the jam gate passes.
      if (!settled && !isEmbedded()) startDemo();
    }, HOST_TIMEOUT_MS);

    void connection.promise
      .then(parent => {
        if (!mounted || settled) return;
        settled = true;
        window.clearTimeout(timeout);
        setDemoMode(false);
        setHostApi(parent);
      })
      .catch(() => {
        if (!settled && !isEmbedded()) startDemo();
      });

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      demoUnsub?.();
      connection.destroy();
    };
  }, []);

  useEffect(() => {
    if (!hostApi || demoMode) return;
    const observer = observeGameContentSize(hostApi);
    return () => observer.disconnect();
  }, [hostApi, demoMode]);

  return { hostApi, snapshot, demoMode };
}
