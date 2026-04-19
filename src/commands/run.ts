import { routeIntent, IntentFlags } from '../router/intent';
import { planCommand } from '../llm/planner';
import { screenPrompt, screenPlan } from '../safety/gate';
import { runBinary } from '../exec/spawner';
import { log } from '../utils/logger';
import { CommandoError } from '../utils/errors';
import { isFaucetIntent, handleFaucet } from './faucet';

// End-to-end handler for `cmdo <prompt> [--sui|--walrus|--site-builder]`.
// Flow: safety(prompt) -> router -> planner -> safety(plan) -> spawn.
export async function runPrompt(
  prompt: string,
  flags: IntentFlags,
): Promise<number> {
  // 1. Pre-LLM safety screen.
  const pre = screenPrompt(prompt);
  if (!pre.ok) {
    log.error(pre.reason || 'unsafe prompt');
    if (pre.hint) log.info(`hint: ${pre.hint}`);
    return 2;
  }

  // 2a. Faucet short-circuit. Faucet has a deterministic shape (one
  // address, one env) and the testnet endpoint needs a custom HTTP call,
  // so we bypass the LLM entirely. Only kicks in when the user did NOT
  // explicitly route to walrus / site-builder.
  if (!flags.walrus && !flags.siteBuilder && isFaucetIntent(prompt)) {
    return handleFaucet(prompt);
  }

  // 2b. Route to a tool + load constrained skill context.
  const intent = routeIntent(prompt, flags);
  log.info(`routed to "${intent.tool}" (${intent.reason})`);
  if (!intent.context.section) {
    log.warn('AGENT.md is empty; run `cmdo update-skills` first.');
  }

  // 3. Ask the planner for a concrete command.
  let plan;
  try {
    plan = await planCommand(prompt, intent.context);
  } catch (err) {
    if (err instanceof CommandoError) {
      log.error(err.message);
      if (err.hint) log.info(`hint: ${err.hint}`);
      return 3;
    }
    throw err;
  }
  log.info(`plan: ${plan.binary} ${plan.args.join(' ')}`);

  // 4. Post-plan safety: binary allowlist + argv screening.
  const post = screenPlan(plan);
  if (!post.ok || !post.resolvedBinary) {
    log.error(post.reason || 'unsafe plan');
    if (post.hint) log.info(`hint: ${post.hint}`);
    return 2;
  }

  // 5. Execute. stdio is inherited so the user sees native output live.
  try {
    const code = await runBinary(post.resolvedBinary, plan.args);
    // Windows STATUS_ILLEGAL_INSTRUCTION. Surfaces when a user on a pre-
    // Skylake CPU runs a binary (usually walrus) built against newer SIMD
    // baselines. Translate the opaque number into something actionable so
    // the user doesn't file a Commando bug for an upstream toolchain issue.
    if (code === -1073741795 || code === 0xc000001d) {
      log.warn(
        'binary exited with STATUS_ILLEGAL_INSTRUCTION (0xC000001D).',
      );
      log.warn(
        '   -> this usually means the upstream binary uses SIMD your CPU does not support (pre-Skylake Intel).',
      );
      log.warn(
        '   -> nothing Commando can fix; try the same command on a newer machine.',
      );
    }
    return code;
  } catch (err) {
    log.error('execution failed:', (err as Error).message);
    return 4;
  }
}
