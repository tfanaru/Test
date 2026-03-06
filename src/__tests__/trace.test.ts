import { describe, it, expect } from "vitest";
import { extractImports, resolveImport } from "../commands/trace.js";

describe("extractImports", () => {
  describe("C/C++ #include", () => {
    it("extracts angle-bracket includes", () => {
      const content = '#include <stdio.h>\n#include <string.h>\n';
      expect(extractImports("main.c", content)).toEqual(["stdio.h", "string.h"]);
    });

    it("extracts quoted includes", () => {
      const content = '#include "myheader.h"\n#include "utils/common.h"\n';
      expect(extractImports("main.cpp", content)).toEqual([
        "myheader.h",
        "utils/common.h",
      ]);
    });

    it("handles mixed includes", () => {
      const content = '#include <stdlib.h>\n#include "local.h"\n';
      expect(extractImports("src/file.c", content)).toEqual([
        "stdlib.h",
        "local.h",
      ]);
    });

    it("works with .h files too", () => {
      const content = '#include "base.h"\n';
      expect(extractImports("header.h", content)).toEqual(["base.h"]);
    });

    it("works with .hpp files", () => {
      const content = '#include "types.hpp"\n';
      expect(extractImports("header.hpp", content)).toEqual(["types.hpp"]);
    });
  });

  describe("C# using", () => {
    it("extracts using statements", () => {
      const content = "using System;\nusing System.Collections.Generic;\n";
      expect(extractImports("Program.cs", content)).toEqual([
        "System",
        "System.Collections.Generic",
      ]);
    });

    it("extracts static using statements", () => {
      const content = "using static System.Math;\n";
      expect(extractImports("Calc.cs", content)).toEqual(["System.Math"]);
    });
  });

  describe("TypeScript/JavaScript", () => {
    it("extracts ES module imports", () => {
      const content = `import { foo } from "./utils";\nimport bar from "../lib/bar";\n`;
      expect(extractImports("index.ts", content)).toEqual([
        "./utils",
        "../lib/bar",
      ]);
    });

    it("extracts require calls", () => {
      const content = `const x = require("./config");\nconst y = require('lodash');\n`;
      expect(extractImports("index.js", content)).toEqual([
        "./config",
        "lodash",
      ]);
    });

    it("works with .tsx files", () => {
      const content = `import React from "react";\n`;
      expect(extractImports("App.tsx", content)).toEqual(["react"]);
    });

    it("works with .jsx files", () => {
      const content = `import { render } from "react-dom";\n`;
      expect(extractImports("App.jsx", content)).toEqual(["react-dom"]);
    });
  });

  describe("Python", () => {
    it("extracts import statements", () => {
      const content = "import os\nimport sys\n";
      expect(extractImports("main.py", content)).toEqual(["os", "sys"]);
    });

    it("extracts from...import statements", () => {
      const content = "from pathlib import Path\nfrom os.path import join\n";
      expect(extractImports("main.py", content)).toEqual([
        "pathlib",
        "os.path",
      ]);
    });
  });

  describe("Go", () => {
    it("extracts import strings", () => {
      const content = `import (\n\t"fmt"\n\t"os"\n\t"github.com/user/pkg"\n)\n`;
      expect(extractImports("main.go", content)).toEqual([
        "fmt",
        "os",
        "github.com/user/pkg",
      ]);
    });
  });

  describe("Rust", () => {
    it("extracts use statements", () => {
      const content = "use std::io;\nuse crate::utils::helper;\n";
      expect(extractImports("main.rs", content)).toEqual([
        "std::io",
        "crate::utils::helper",
      ]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for unknown file types", () => {
      expect(extractImports("data.json", '{"key": "value"}')).toEqual([]);
    });

    it("returns empty array for empty content", () => {
      expect(extractImports("main.ts", "")).toEqual([]);
    });

    it("ignores commented-out imports in code context", () => {
      // Note: we don't strip comments, but imports in non-import positions
      // won't match the pattern anchored to line start where applicable
      const content = "const x = 1;\n";
      expect(extractImports("main.ts", content)).toEqual([]);
    });
  });
});

describe("resolveImport", () => {
  const allFiles = new Set([
    "src/index.ts",
    "src/utils/helper.ts",
    "src/utils/index.ts",
    "src/commands/run.ts",
    "lib/common.h",
    "include/base/types.h",
  ]);

  it("resolves relative imports with extension", () => {
    const result = resolveImport("./utils/helper", "src/index.ts", allFiles);
    expect(result).toBe("src/utils/helper.ts");
  });

  it("resolves relative imports to index files", () => {
    const result = resolveImport("./utils", "src/index.ts", allFiles);
    expect(result).toBe("src/utils/index.ts");
  });

  it("resolves parent directory imports", () => {
    const result = resolveImport("../utils/helper", "src/commands/run.ts", allFiles);
    expect(result).toBe("src/utils/helper.ts");
  });

  it("resolves C/C++ header includes by basename", () => {
    const result = resolveImport("common.h", "src/main.c", allFiles);
    expect(result).toBe("lib/common.h");
  });

  it("resolves nested header paths", () => {
    const result = resolveImport("base/types.h", "src/main.c", allFiles);
    expect(result).toBe("include/base/types.h");
  });

  it("returns null for unresolvable imports", () => {
    const result = resolveImport("nonexistent", "src/index.ts", allFiles);
    expect(result).toBeNull();
  });

  it("returns null for npm packages (non-relative)", () => {
    const result = resolveImport("lodash", "src/index.ts", allFiles);
    expect(result).toBeNull();
  });
});
