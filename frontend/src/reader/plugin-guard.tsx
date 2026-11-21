/** What stands between plugin code and the reader: a plugin that throws
 * loses its own contribution and nothing else. */

import { Component, type ReactNode } from "react";

/** Calls a plugin's renderer inside its own render, so the boundary above catches it. */
function Drawn({ draw }: { draw: () => ReactNode }) {
  return <>{draw()}</>;
}

/** The message a thrown value carries, whatever was thrown. */
export function failureText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Runs plugin code the reader needs a value from; a throw yields `fallback`.
 * `onError` hears the cause, so a caller can say which plugin failed. */

export function safeCall<T>(run: () => T, fallback: T, onError?: (cause: unknown) => void): T {
  try {
    return run();
  } catch (cause) {
    onError?.(cause);
    return fallback;
  }
}

/** A boundary around one plugin's drawing. `fallback` replaces a failed
 * contribution; without one the failure is stated where it stood, as an
 * alert naming the plugin. */

export class PluginGuard extends Component<
  { plugin: string; fallback?: ReactNode; children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(cause: unknown) {
    return { error: failureText(cause) };
  }

  render() {
    if (this.state.error === null) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <p role="alert" data-testid={`plugin-failure-${this.props.plugin}`}>
        {this.props.plugin}: {this.state.error}
      </p>
    );
  }
}

/** A plugin renderer the reader calls to get its drawing: guarded, and run
 * inside the guard rather than in the caller's render, where a throw would
 * escape the boundary that is meant to catch it. */

export function PluginDraw({
  plugin,
  draw,
  fallback,
}: {
  plugin: string;
  draw: () => ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <PluginGuard plugin={plugin} fallback={fallback}>
      <Drawn draw={draw} />
    </PluginGuard>
  );
}
