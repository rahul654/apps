import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface FrameProps {
  src?: string;
  srcDoc?: string;
  sandbox: string;
  allow: string;
  referrerPolicy?: ReferrerPolicy;
  credentialless?: boolean;
  title: string;
  onLoad?: () => void;
  frameRef?: RefObject<HTMLIFrameElement | null>;
}

/**
 * An iframe built by hand rather than by React. Sandbox flags, `allow` and `credentialless` only
 * take effect if they are set before the frame is inserted and starts navigating, and React
 * doesn't render `credentialless` at all. Any change to these props creates a fresh frame.
 */
export function SandboxFrame({ src, srcDoc, sandbox, allow, referrerPolicy, credentialless = false, title, onLoad, frameRef }: FrameProps) {
  const host = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useLayoutEffect(() => {
    const f = document.createElement('iframe');
    f.className = 'frame';
    f.setAttribute('sandbox', sandbox);
    if (allow) f.setAttribute('allow', allow);
    if (referrerPolicy) f.setAttribute('referrerpolicy', referrerPolicy);
    if (credentialless) f.setAttribute('credentialless', '');
    f.addEventListener('load', () => onLoadRef.current?.());
    if (srcDoc !== undefined) f.srcdoc = srcDoc;
    else if (src) f.src = src;
    host.current!.appendChild(f);
    if (frameRef) frameRef.current = f;
    return () => {
      f.remove();
      if (frameRef && frameRef.current === f) frameRef.current = null;
    };
  }, [src, srcDoc, sandbox, allow, referrerPolicy, credentialless, frameRef]);

  useEffect(() => {
    host.current?.querySelector('iframe')?.setAttribute('title', title);
  }, [title, src, srcDoc, sandbox, allow, referrerPolicy, credentialless]);

  return <div ref={host} className="frame-host" />;
}
