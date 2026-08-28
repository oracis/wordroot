// 生成一个最小但合法的 PDF（含英文文本），用于验证 pdf.js 渲染与划词
const fs = require("fs");
const objects = [];
objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
objects[3] =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 460 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
const stream = "BT /F1 30 Tf 40 150 Td (trajectory project eject object) Tj ET";
objects[5] = "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream";

let pdf = "%PDF-1.4\n";
const offsets = [];
for (let i = 1; i <= 5; i++) {
  offsets[i] = Buffer.byteLength(pdf, "latin1");
  pdf += i + " 0 obj\n" + objects[i] + "\nendobj\n";
}
const xrefStart = Buffer.byteLength(pdf, "latin1");
pdf += "xref\n0 6\n0000000000 65535 f \n";
for (let i = 1; i <= 5; i++) {
  pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
}
pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";

fs.writeFileSync(__dirname + "/sample.pdf", Buffer.from(pdf, "latin1"));
console.log("wrote sample.pdf bytes=", Buffer.byteLength(pdf, "latin1"));
