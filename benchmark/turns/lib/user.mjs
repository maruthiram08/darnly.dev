// The simulated user: a non-technical person who sees the app, not the code.
// After each agent turn, the harness reloads the app and tells this "user" what is now on screen.
// The user then answers the agent's question (only with what they know) or says what they see.
import { ask } from './session.mjs';

const SYSTEM = `You play a busy, non-technical person who builds their web app by talking to an AI coding agent in the terminal.
You cannot read code. You don't know file names, components, CSS or selectors, and you never guess them.
You only know what you see in the app in your browser, plus the facts you are given.
Write your reply to the agent: one to three short, plain sentences, like a chat message. No greetings, no lists, no code.
Rules:
- If the agent asked you something, answer it using only the facts and what you see. If the facts don't cover it, say you don't know or that you only noticed it where you did.
- If what you see now shows the problem is still there, or something else changed that you didn't want, say so plainly.
- If the agent asked whether to go ahead with something, say yes, go ahead, unless the facts say otherwise.
- Never tell the agent how to fix it.`;

export async function simulatedUserReply({ bug, agentText, observations, model, claudeBin, cwd }) {
  const prompt = `The bug you reported: "${bug.note}"

Facts you know (from looking at the app; only share what is asked or relevant):
${bug.user.map((f) => `- ${f}`).join('\n')}

The agent's last message to you:
"""
${(agentText ?? '').slice(-3000)}
"""

You just reloaded the app and looked. What you see now:
${observations.map((o) => `- ${o}`).join('\n')}

Write your reply to the agent.`;
  return ask({ prompt, system: SYSTEM, model, claudeBin, cwd });
}
