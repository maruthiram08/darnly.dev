// /llms.txt: a short map of the site for AI assistants (https://llmstxt.org). Built from src/data/site.ts.
import { llmsTxt, textResponse } from '../data/llms';

export const GET = () => textResponse(llmsTxt());
