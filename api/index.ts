import { createExpressApp } from "../dist/api.js";

const app = createExpressApp();

export default function handler(req: any, res: any) {
  return app(req, res);
}