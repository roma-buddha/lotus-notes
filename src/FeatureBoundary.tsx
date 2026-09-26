import { Component, type ReactNode } from "react";
export class FeatureBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert" className="empty-note">
          <p>
            This panel could not open. Your saved notes and recovery drafts are
            preserved.
          </p>
          <button onClick={() => window.location.reload()}>Reload Lotus</button>
        </div>
      );
    return this.props.children;
  }
}
