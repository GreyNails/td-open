/** A deliberately small arithmetic language. No eval, property access or JS globals. */
type Expr = (vars: Record<string, number>) => number;
const functions: Record<string, (...x: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  sign: Math.sign,
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  mix: (a, b, t) => a + (b - a) * t,
};
export function compileExpression(source: string): Expr {
  if (source.length > 2048) throw new Error("表达式不能超过 2048 字符");
  const tokens =
    source.match(
      /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_]\w*|<=|>=|==|!=|&&|\|\||[^\s]/gi,
    ) ?? [];
  if (tokens.length > 512) throw new Error("表达式过于复杂");
  let pos = 0,
    depth = 0;
  const precedence: Record<string, number> = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 4,
    ">": 4,
    "<=": 4,
    ">=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
    "^": 7,
  };
  const binary = (op: string, a: number, b: number) => {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        if (!b) throw new Error("表达式除数为零");
        return a / b;
      case "%":
        if (!b) throw new Error("表达式取模除数为零");
        return a % b;
      case "^":
        return a ** b;
      case "<":
        return +(a < b);
      case ">":
        return +(a > b);
      case "<=":
        return +(a <= b);
      case ">=":
        return +(a >= b);
      case "==":
        return +(a === b);
      case "!=":
        return +(a !== b);
      case "&&":
        return +(!!a && !!b);
      case "||":
        return +(!!a || !!b);
      default:
        throw new Error("未知运算符");
    }
  };
  const atom = (): Expr => {
    if (++depth > 64) throw new Error("表达式嵌套过深");
    const token = tokens[pos++];
    let result: Expr;
    if (token === "+" || token === "-" || token === "!") {
      const value = expression(7);
      result = (v) =>
        token === "-" ? -value(v) : token === "!" ? +!value(v) : value(v);
    } else if (token === "(") {
      result = expression(0);
      if (tokens[pos++] !== ")") throw new Error("缺少右括号");
    } else if (token && /^(?:\d|\.\d)/.test(token)) {
      const value = Number(token);
      result = () => value;
    } else if (token && /^[a-z_]\w*$/i.test(token)) {
      if (tokens[pos] === "(") {
        const fn = Object.hasOwn(functions, token)
          ? functions[token]
          : undefined;
        if (!fn) throw new Error(`未允许的函数：${token}`);
        pos++;
        const args: Expr[] = [];
        if (tokens[pos] !== ")")
          do {
            args.push(expression(0));
          } while (tokens[pos] === "," && ++pos);
        if (tokens[pos++] !== ")") throw new Error("函数缺少右括号");
        result = (v) => fn(...args.map((a) => a(v)));
      } else {
        if (
          ![
            "x",
            "y",
            "i",
            "c",
            "t",
            "n",
            "r",
            "col",
            "row",
            "pi",
            "e",
          ].includes(token)
        )
          throw new Error(`未允许的变量：${token}`);
        result = (v) =>
          token === "pi" ? Math.PI : token === "e" ? Math.E : (v[token] ?? 0);
      }
    } else throw new Error(`无效表达式符号：${token ?? "结尾"}`);
    depth--;
    return result;
  };
  const expression = (minimum: number): Expr => {
    let left = atom();
    while ((precedence[tokens[pos]] ?? -1) >= minimum) {
      const op = tokens[pos++],
        right = expression(precedence[op] + (op === "^" ? 0 : 1)),
        previous = left;
      left = (v) => binary(op, previous(v), right(v));
    }
    return left;
  };
  const expr = expression(0);
  if (pos !== tokens.length)
    throw new Error(`不支持的表达式语法：${tokens[pos]}`);
  return (vars) => {
    const value = expr(vars);
    if (!Number.isFinite(value)) throw new Error("表达式产生非有限数值");
    return value;
  };
}
