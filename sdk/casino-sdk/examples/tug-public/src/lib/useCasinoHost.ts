import { useEffect, useState } from 'react';
import {
  connectGameToHost,
  observeGameContentSize,
  type GuestApiV1,
  type HostApiV1,
  type HostSnapshotV1,
} from '@chain/casino-sdk/guest';
import { createDemoHost, isEmbedded, wantsDemoMode } from './demoHost';

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

    // A top-level page has no host. Connecting Penpal to window.parent
    // (itself) can self-handshake and leave the snapshot permanently null.
    if (wantsDemoMode() || !isEmbedded()) {
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

    void connection.promise
      .then(parent => {
        if (!mounted || settled) return;
        settled = true;
        setDemoMode(false);
        setHostApi(parent);
      })
      .catch(() => {
        // Embedded games never substitute demo outcomes for a failed bridge.
      });

    return () => {
      mounted = false;
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
