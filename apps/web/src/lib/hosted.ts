/**
 * True in the static hosted demo build (NEXT_PUBLIC_DAGGLER_HOSTED=1).
 * That build has no server: validation, the DAG view, simulation and the
 * policy checks run in the browser; running workflows, GitHub dispatch,
 * repo mapping and AI are only available in a local install.
 */
export const HOSTED = process.env.NEXT_PUBLIC_DAGGLER_HOSTED === "1";

export const CLI_CTA = "npx daggler-cli";
