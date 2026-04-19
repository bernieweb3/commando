import { generateSkills } from '../skills/generator';
import { log } from '../utils/logger';

// Re-runs the skill generator and overwrites ~/.commando/skills/AGENT.md.
// This is the recovery command when binaries are updated and the command
// surface drifts from what the LLM was last told.
export async function updateSkillsCmd(): Promise<number> {
  try {
    const md = await generateSkills();
    if (!md) return 1;
    log.success('AGENT.md updated.');
    return 0;
  } catch (err) {
    log.error('failed to update skills:', (err as Error).message);
    return 1;
  }
}
