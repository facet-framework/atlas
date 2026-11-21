/** Atlas exposes one namespace per screen group to avoid equal-name collisions.
 * Pages render props and emit callbacks; state, loading and routing live in src/reader. */

export * as frame from "./frame";
export * as records from "./records";
export * as contents from "./contents";
export * as plugins from "./plugins";
