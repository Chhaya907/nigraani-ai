import { createExpressApp } from "../server/app";

const app: any = createExpressApp();

export default function handler(req: any, res: any) {
  return app(req, res);
}
