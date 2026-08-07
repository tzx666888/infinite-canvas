import assert from "node:assert/strict";

import { canvasNodeErrorMessage, describeCanvasNodeError } from "../src/app/(user)/canvas/utils/node-error-display.ts";

const projectUpload = describeCanvasNodeError("error 500: Flow2API upstream error: Project-scoped image upload failed via /flow/uploadImage (project_id=private)");
assert.equal(projectUpload.title, "参考素材暂时无法提交");
assert.equal("detail" in projectUpload, false);
assert.doesNotMatch(JSON.stringify(projectUpload), /flow2api|project|upload/i);
assert.doesNotMatch(canvasNodeErrorMessage("Flow2API upstream error: Project-scoped image upload failed via /flow/uploadImage (project_id=private)"), /flow2api|project|upload/i);

assert.equal(describeCanvasNodeError("当前令牌剩余额度 $1.39，请求需要 $1.50").title, "账户额度不足");
assert.equal(describeCanvasNodeError("当前模型需要 Ult 账号，但没有可用的 Ult 账号").title, "当前模型暂不可用");
assert.equal(describeCanvasNodeError("PUBLIC_ERROR_UNSAFE_GENERATION").title, "内容审核未通过");
assert.equal(describeCanvasNodeError("Flow2API upstream error: PUBLIC_ERROR_UNSAFE_GENERATION").title, "内容审核未通过");
assert.equal(describeCanvasNodeError("reference_image_unsafe_error").title, "参考人物图未通过隐私审核");
assert.equal(describeCanvasNodeError("参考图片未通过 seedance-2.0 隐私检查，请更换图片后重试。").title, "参考人物图未通过隐私审核");
assert.match(canvasNodeErrorMessage("reference_image_unsafe_error"), /自动退回额度/);
assert.equal(describeCanvasNodeError("upstream returned an invalid response").title, "生成失败");
assert.equal(describeCanvasNodeError("upstream request timed out").title, "生成超时，请重试");
assert.doesNotMatch(canvasNodeErrorMessage("Flow2API upstream error: PUBLIC_ERROR_UNSAFE_GENERATION"), /flow2api|upstream|public_error/i);

console.log("Canvas node error presentation regression checks passed");
