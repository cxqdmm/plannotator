/** Who hears the event stream's `event: requirements` (the window has one stream; useRequirements listens here). */
export const requirementFrameListeners = new Set<(ids: string[]) => void>();
export const subscribeRequirementFrames = (listener: (ids: string[]) => void) => {
  requirementFrameListeners.add(listener);
  return () => {
    requirementFrameListeners.delete(listener);
  };
};
