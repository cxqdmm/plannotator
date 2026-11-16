// Pinned guides.show viewer build (static in this fork: the generator app was
// removed). Update only when deliberately re-pinning a newer guides.show
// viewer build. Describes the viewer this Plannotator build pins into
// exported guides (paths relative to the viewer base URL, plus SRI hashes).
import type { GuideViewerAssets } from "./guide-format";

export const GUIDE_VIEWER_MANIFEST: Omit<GuideViewerAssets, "baseUrl"> = {
  js: "viewer.C4IxWdQK.js",
  css: "viewer.ar3IkrTA.css",
  jsIntegrity: "sha384-/CN5/b1UaCPABarntRCUXuoteCDyOFWmVKIH89L7OkP+C4SZpr+hjB2s0jxwcGsT",
  cssIntegrity: "sha384-rfwMLk0stnSlvTmukoNd6MUtn6ZzzWIurpSZLexgtBM97W25ST/Z1WaMxJwpfvP/",
  langs: {

  },
};
