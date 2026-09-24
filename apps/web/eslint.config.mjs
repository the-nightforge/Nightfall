import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

// Chỉ hai luật của hooks: đây là lớp lỗi duy nhất mà `tsc` (script lint cũ)
// không bắt được. Không bật bộ recommended nào khác, vì thêm luật là thêm
// tiếng ồn mà không bắt thêm bug.
export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser },
    plugins: { "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
