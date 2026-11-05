import type { Env } from '../env';
import { dispatch } from '../util/http';

/** ChatDO（後のマイルストーンで中身を作る） */
export class ChatDO {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(req: Request): Promise<Response> {
    void this.state; void this.env;
    return dispatch(req, {});
  }
}
