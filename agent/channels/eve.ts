import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Public demo: anyone can reach the session routes. Replace with a real
    // policy (httpBasic/jwt/oidc or a custom AuthFn) before shipping real data.
    none(),
  ],
});
