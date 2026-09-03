"use client";
import { registerLandingTools } from "../webmcp/register";
import { useWebMcp, WebMcpPill } from "./webmcp-provider";

/** Registers create_event and add_guests on a page with no event, so an agent starts from the landing page. */
export function LandingWebMcp({ pill = false }: { pill?: boolean }) {
  const status = useWebMcp((signal) => registerLandingTools({ signal }), []);
  return pill ? <WebMcpPill status={status} /> : <span hidden data-testid="webmcp-status" data-status={status} />;
}
