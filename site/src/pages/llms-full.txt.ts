// /llms-full.txt: /llms.txt plus each tool's longer description from its page.
import { llmsFullTxt, textResponse } from '../data/llms';

export const GET = () => textResponse(llmsFullTxt());
