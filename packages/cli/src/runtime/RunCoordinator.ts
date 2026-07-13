export type RunSurface = "terminal" | "web";
export type ReleaseRun = () => void;

/** Serializes terminal and browser ownership of the shared agent runtime. */
export class RunCoordinator {
  private activeSurface: RunSurface | null = null;

  /** Acquires the runtime and returns an idempotent release callback. */
  public acquire(surface: RunSurface): ReleaseRun | undefined {
    if (this.activeSurface !== null) return undefined;
    this.activeSurface = surface;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      if (this.activeSurface === surface) this.activeSurface = null;
    };
  }

  /** Reports whether any surface, or a specific surface, owns the runtime. */
  public isActive(surface?: RunSurface): boolean {
    return surface
      ? this.activeSurface === surface
      : this.activeSurface !== null;
  }
}
