// Luraph VM Lifter v5.0 - 200+ opcode semantic rules
// Demonology X10

import { IRStmt } from "./luraph-structure";
import { Sym } from "./luraph-lifter";

export interface OpcodeRule {
  op: number;
  mnemonic: string;
  build: (vip: number, cols: Map<string, number>, consts: Map<number, unknown>, regs: number) => IRStmt[];
}

function R(n: number): Sym { return { k: "reg", n }; }
function K(v: unknown): Sym { return { k: "konst", v }; }
function I(v: number | boolean | null | object): Sym { return { k: "imm", v }; }
function G(name: string): Sym { return { k: "global", name }; }
function Bin(op: string, a: Sym, b: Sym): Sym { return { k: "bin", op, a, b }; }
function Un(op: string, a: Sym): Sym { return { k: "un", op, a }; }
function Idx(obj: Sym, key: Sym): Sym { return { k: "index", obj, key }; }

const RULES: OpcodeRule[] = [

  // Arithmetic
  { op: 0x00, mnemonic: "ADD_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("+",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x01, mnemonic: "ADD_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("+",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x02, mnemonic: "SUB_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("-",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x03, mnemonic: "SUB_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("-",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x04, mnemonic: "MUL_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("*",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x05, mnemonic: "MUL_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("*",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x06, mnemonic: "DIV_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("/",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x07, mnemonic: "DIV_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("/",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x08, mnemonic: "MOD_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("%",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x09, mnemonic: "MOD_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("%",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x0A, mnemonic: "POW_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("^",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x0B, mnemonic: "POW_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("^",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x0C, mnemonic: "IDIV_RR", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("//", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x0D, mnemonic: "IDIV_RC", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("//", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },

  // Bitwise
  { op: 0x10, mnemonic: "BAND_RR", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("&",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x11, mnemonic: "BOR_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("|",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x12, mnemonic: "BXOR_RR", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("~",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x13, mnemonic: "SHL_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<<", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x14, mnemonic: "SHR_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin(">>", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x15, mnemonic: "BNOT_R",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("~",  R(c.get("B")||0)) }] },
  { op: 0x16, mnemonic: "BAND_RC", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("&",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x17, mnemonic: "BOR_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("|",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x18, mnemonic: "BXOR_RC", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("~",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x19, mnemonic: "SHL_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<<", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x1A, mnemonic: "SHR_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin(">>", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },

  // Comparison
  { op: 0x20, mnemonic: "EQ_RR",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("==", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x21, mnemonic: "LT_RR",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x22, mnemonic: "LE_RR",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<=", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x23, mnemonic: "NEQ_RR",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("~=", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x24, mnemonic: "GT_RR",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin(">",  R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x25, mnemonic: "GE_RR",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin(">=", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x26, mnemonic: "EQ_RC",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("==", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x27, mnemonic: "LT_RC",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x28, mnemonic: "LE_RC",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<=", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x29, mnemonic: "NEQ_RC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("~=", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },

  // Jumps
  { op: 0x30, mnemonic: "JMP",     build: (v,c,k,r) => [{ kind: "jump", target: c.get("sBx")||0 }] },
  { op: 0x31, mnemonic: "JEQ",     build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("==", R(c.get("A")||0), R(c.get("B")||0)), target: c.get("sBx")||0 }] },
  { op: 0x32, mnemonic: "JLT",     build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("<",  R(c.get("A")||0), R(c.get("B")||0)), target: c.get("sBx")||0 }] },
  { op: 0x33, mnemonic: "JLE",     build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("<=", R(c.get("A")||0), R(c.get("B")||0)), target: c.get("sBx")||0 }] },
  { op: 0x34, mnemonic: "JNE",     build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("~=", R(c.get("A")||0), R(c.get("B")||0)), target: c.get("sBx")||0 }] },
  { op: 0x35, mnemonic: "JGT",     build: (v,c,k,r) => [{ kind: "condjump", cond: Bin(">",  R(c.get("A")||0), R(c.get("B")||0)), target: c.get("sBx")||0 }] },
  { op: 0x36, mnemonic: "JGE",     build: (v,c,k,r) => [{ kind: "condjump", cond: Bin(">=", R(c.get("A")||0), R(c.get("B")||0)), target: c.get("sBx")||0 }] },
  { op: 0x37, mnemonic: "JTRUE",   build: (v,c,k,r) => [{ kind: "condjump", cond: R(c.get("A")||0), target: c.get("sBx")||0 }] },
  { op: 0x38, mnemonic: "JFALSE",  build: (v,c,k,r) => [{ kind: "condjump", cond: Un("not", R(c.get("A")||0)), target: c.get("sBx")||0 }] },
  { op: 0x39, mnemonic: "JEQ_K",   build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("==", R(c.get("A")||0), K(k.get(c.get("B")||0))), target: c.get("sBx")||0 }] },
  { op: 0x3A, mnemonic: "JLT_K",   build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("<",  R(c.get("A")||0), K(k.get(c.get("B")||0))), target: c.get("sBx")||0 }] },
  { op: 0x3B, mnemonic: "JLE_K",   build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("<=", R(c.get("A")||0), K(k.get(c.get("B")||0))), target: c.get("sBx")||0 }] },
  { op: 0x3C, mnemonic: "JNE_K",   build: (v,c,k,r) => [{ kind: "condjump", cond: Bin("~=", R(c.get("A")||0), K(k.get(c.get("B")||0))), target: c.get("sBx")||0 }] },

  // Table
  { op: 0x40, mnemonic: "GETTABLE",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x41, mnemonic: "SETTABLE",   build: (v,c,k,r) => [{ kind: "kstore", obj: R(c.get("A")||0), key: R(c.get("B")||0), val: R(c.get("C")||0) }] },
  { op: 0x42, mnemonic: "GETTABLE_K", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0x43, mnemonic: "SETTABLE_K", build: (v,c,k,r) => [{ kind: "kstore", obj: R(c.get("A")||0), key: K(k.get(c.get("B")||0)), val: R(c.get("C")||0) }] },
  { op: 0x44, mnemonic: "NEWTABLE",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I({}) }] },
  { op: 0x45, mnemonic: "SETLIST",    build: (v,c,k,r) => {
    const stmts: IRStmt[] = [];
    const a = c.get("A")||0, b = c.get("B")||0;
    for (let i = 1; i <= b; i++) stmts.push({ kind: "kstore", obj: R(a), key: I(i), val: R(a + i) });
    return stmts;
  }},
  { op: 0x46, mnemonic: "GETTABUP",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(G("U"+(c.get("B")||0)), K(k.get(c.get("C")||0))) }] },
  { op: 0x47, mnemonic: "SETTABUP",   build: (v,c,k,r) => [{ kind: "kstore", obj: G("U"+(c.get("A")||0)), key: K(k.get(c.get("B")||0)), val: R(c.get("C")||0) }] },

  // Call / Return
  { op: 0x50, mnemonic: "CALL",       build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: c.get("B")||0, retc: c.get("C")||0 }] },
  { op: 0x51, mnemonic: "RETURN",     build: (v,c,k,r) => [{ kind: "ret", retKind: (c.get("B")||0) > 0 ? "values" : "void" }] },
  { op: 0x52, mnemonic: "RETURN_M",   build: (v,c,k,r) => [{ kind: "ret", retKind: "values" }] },
  { op: 0x53, mnemonic: "VARARG",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G("...") }] },
  { op: 0x54, mnemonic: "CLOSURE",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I("proto_"+(c.get("Bx")||0)) }] },
  { op: 0x55, mnemonic: "SELF",       build: (v,c,k,r) => [
    { kind: "assign", reg: c.get("A")||0 + 1, src: R(c.get("B")||0) },
    { kind: "assign", reg: c.get("A")||0,     src: Idx(R(c.get("B")||0), K(k.get(c.get("C")||0))) }
  ]},
  { op: 0x56, mnemonic: "TAILCALL",   build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: c.get("B")||0, retc: 0 }] },

  // Upvalues / Globals
  { op: 0x60, mnemonic: "GETUPVAL",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G("U"+(c.get("B")||0)) }] },
  { op: 0x61, mnemonic: "SETUPVAL",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("B")||0, src: R(c.get("A")||0) }] },
  { op: 0x62, mnemonic: "GETGLOBAL",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G(String(k.get(c.get("Bx")||0) || "_G")) }] },
  { op: 0x63, mnemonic: "SETGLOBAL",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G(String(k.get(c.get("Bx")||0) || "_G")) }] },

  // Unary
  { op: 0x70, mnemonic: "LEN",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("#", R(c.get("B")||0)) }] },
  { op: 0x71, mnemonic: "CONCAT",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("..", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x72, mnemonic: "NOT",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("not", R(c.get("B")||0)) }] },
  { op: 0x73, mnemonic: "UNM",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("-", R(c.get("B")||0)) }] },

  // Move / Load
  { op: 0x80, mnemonic: "MOVE",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x81, mnemonic: "LOADK",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: K(k.get(c.get("Bx")||0)) }] },
  { op: 0x82, mnemonic: "LOADBOOL",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I(c.get("B")||0 === 1) }] },
  { op: 0x83, mnemonic: "LOADNIL",    build: (v,c,k,r) => {
    const stmts: IRStmt[] = [];
    const a = c.get("A")||0, b = c.get("B")||0;
    for (let i = a; i <= a + b; i++) stmts.push({ kind: "assign", reg: i, src: I(null) });
    return stmts;
  }},
  { op: 0x84, mnemonic: "GETIMPORT",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G(String(k.get(c.get("Bx")||0) || "unknown")) }] },
  { op: 0x85, mnemonic: "LOADN",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I(c.get("sBx")||0) }] },

  // For loops
  { op: 0x90, mnemonic: "FORPREP",    build: (v,c,k,r) => [{ kind: "jump", target: v + (c.get("sBx")||0) + 1 }] },
  { op: 0x91, mnemonic: "FORLOOP",    build: (v,c,k,r) => [{ kind: "condjump", cond: I(true), target: v + (c.get("sBx")||0) + 1 }] },
  { op: 0x92, mnemonic: "TFORLOOP",   build: (v,c,k,r) => [{ kind: "condjump", cond: R(c.get("A")||0), target: v + 1 }] },
  { op: 0x93, mnemonic: "TFORPREP",   build: (v,c,k,r) => [{ kind: "jump", target: v + (c.get("sBx")||0) + 1 }] },

  // Close / Misc
  { op: 0xA0, mnemonic: "CLOSE",      build: (v,c,k,r) => [{ kind: "clearrange", lo: c.get("A")||0, hi: r }] },
  { op: 0xA1, mnemonic: "NOP",        build: (v,c,k,r) => [{ kind: "comment", text: "NOP" }] },
  { op: 0xA2, mnemonic: "BREAK",      build: (v,c,k,r) => [{ kind: "jump", target: v + 1 }] },

  // VM helpers
  { op: 0xB0, mnemonic: "VM_INIT",    build: (v,c,k,r) => [{ kind: "comment", text: "VM init" }] },
  { op: 0xB1, mnemonic: "VM_DECODE",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("+", R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0xB2, mnemonic: "VM_XOR",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("~", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0xB3, mnemonic: "VM_ROL",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<<", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0xB4, mnemonic: "VM_ROR",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin(">>", R(c.get("B")||0), R(c.get("C")||0)) }] },

  // Extended arithmetic
  { op: 0xC0, mnemonic: "ADD_RK",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("+",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0xC1, mnemonic: "SUB_RK",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("-",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0xC2, mnemonic: "MUL_RK",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("*",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0xC3, mnemonic: "DIV_RK",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("/",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0xC4, mnemonic: "MOD_RK",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("%",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },
  { op: 0xC5, mnemonic: "POW_RK",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("^",  R(c.get("B")||0), K(k.get(c.get("C")||0))) }] },

  // String ops
  { op: 0xD0, mnemonic: "SCHAR",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("char")), args: [R(c.get("B")||0)] } }] },
  { op: 0xD1, mnemonic: "SBYTE",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("byte")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xD2, mnemonic: "SSUB",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("sub")), args: [R(c.get("B")||0), R(c.get("C")||0), R(c.get("D")||0)] } }] },
  { op: 0xD3, mnemonic: "SGSUB",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("gsub")), args: [R(c.get("B")||0), R(c.get("C")||0), R(c.get("D")||0)] } }] },
  { op: 0xD4, mnemonic: "SLEN",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("#", R(c.get("B")||0)) }] },
  { op: 0xD5, mnemonic: "SREP",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("rep")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xD6, mnemonic: "SMATCH",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("match")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xD7, mnemonic: "SGMATCH",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("gmatch")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xD8, mnemonic: "SFIND",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("find")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xD9, mnemonic: "SFORMAT",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("string"), I("format")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },

  // Table builtins
  { op: 0xE0, mnemonic: "TINSERT",    build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 2, retc: 0 }] },
  { op: 0xE1, mnemonic: "TREMOVE",    build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0xE2, mnemonic: "TSORT",      build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0xE3, mnemonic: "TCONCAT",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("table"), I("concat")), args: [R(c.get("B")||0)] } }] },
  { op: 0xE4, mnemonic: "TUNPACK",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("unpack"), args: [R(c.get("B")||0)] } }] },

  // Math builtins
  { op: 0xF0, mnemonic: "MFLOOR",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("floor")), args: [R(c.get("B")||0)] } }] },
  { op: 0xF1, mnemonic: "MCEIL",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("ceil")), args: [R(c.get("B")||0)] } }] },
  { op: 0xF2, mnemonic: "MABS",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("abs")), args: [R(c.get("B")||0)] } }] },
  { op: 0xF3, mnemonic: "MSQRT",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("sqrt")), args: [R(c.get("B")||0)] } }] },
  { op: 0xF4, mnemonic: "MRANDOM",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("random")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xF5, mnemonic: "MSEED",      build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0xF6, mnemonic: "MMIN",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("min")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xF7, mnemonic: "MMAX",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("max")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0xF8, mnemonic: "MPOW",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("math"), I("pow")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },

  // Coroutine / Task
  { op: 0x100, mnemonic: "CORO_CREATE", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("coroutine"), I("create")), args: [R(c.get("B")||0)] } }] },
  { op: 0x101, mnemonic: "CORO_RESUME", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("coroutine"), I("resume")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x102, mnemonic: "CORO_YIELD",  build: (v,c,k,r) => [{ kind: "ret", retKind: "values" }] },
  { op: 0x103, mnemonic: "CORO_STATUS", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("coroutine"), I("status")), args: [R(c.get("B")||0)] } }] },
  { op: 0x104, mnemonic: "CORO_WRAP",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("coroutine"), I("wrap")), args: [R(c.get("B")||0)] } }] },
  { op: 0x105, mnemonic: "TASK_SPAWN",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("task"), I("spawn")), args: [R(c.get("B")||0)] } }] },
  { op: 0x106, mnemonic: "TASK_WAIT",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("task"), I("wait")), args: [R(c.get("B")||0)] } }] },
  { op: 0x107, mnemonic: "TASK_DELAY",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("task"), I("delay")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x108, mnemonic: "TASK_DEFER",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("task"), I("defer")), args: [R(c.get("B")||0)] } }] },

  // Debug / Reflection
  { op: 0x110, mnemonic: "DGETINFO",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("debug"), I("getinfo")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x111, mnemonic: "DGETUPVAL",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("debug"), I("getupvalue")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x112, mnemonic: "DSETUPVAL",   build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 3, retc: 0 }] },
  { op: 0x113, mnemonic: "DTRACEBACK",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("debug"), I("traceback")), args: [] } }] },
  { op: 0x114, mnemonic: "GETMT",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("getmetatable"), args: [R(c.get("B")||0)] } }] },
  { op: 0x115, mnemonic: "SETMT",       build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 2, retc: 0 }] },
  { op: 0x116, mnemonic: "RAWMSET",     build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 3, retc: 0 }] },
  { op: 0x117, mnemonic: "RAWMGET",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("rawget"), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x118, mnemonic: "PCALL",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("pcall"), args: [R(c.get("B")||0)] } }] },
  { op: 0x119, mnemonic: "XPCALL",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("xpcall"), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x11A, mnemonic: "ASSERT",      build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 2, retc: 0 }] },
  { op: 0x11B, mnemonic: "ERROR",       build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0x11C, mnemonic: "TYPEOF",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("typeof"), args: [R(c.get("B")||0)] } }] },
  { op: 0x11D, mnemonic: "TYPE",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("type"), args: [R(c.get("B")||0)] } }] },

  // Roblox-specific
  { op: 0x120, mnemonic: "RBX_INSTANCE",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("Instance"), I("new")), args: [R(c.get("B")||0)] } }] },
  { op: 0x121, mnemonic: "RBX_WAITFORCHILD", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("WaitForChild")), args: [R(c.get("C")||0)] } }] },
  { op: 0x122, mnemonic: "RBX_GETCHILDREN",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("GetChildren")), args: [] } }] },
  { op: 0x123, mnemonic: "RBX_CLONE",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("Clone")), args: [] } }] },
  { op: 0x124, mnemonic: "RBX_DESTROY",      build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 0, retc: 0 }] },
  { op: 0x125, mnemonic: "RBX_CONNECT",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("Connect")), args: [R(c.get("C")||0)] } }] },
  { op: 0x126, mnemonic: "RBX_DISCONNECT",   build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 0, retc: 0 }] },
  { op: 0x127, mnemonic: "RBX_FIRE",         build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0x128, mnemonic: "RBX_GETSERVICE",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("game"), I("GetService")), args: [R(c.get("B")||0)] } }] },
  { op: 0x129, mnemonic: "RBX_ISA",          build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("IsA")), args: [R(c.get("C")||0)] } }] },
  { op: 0x12A, mnemonic: "RBX_FINDFIRSTCHILD", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("FindFirstChild")), args: [R(c.get("C")||0)] } }] },
  { op: 0x12B, mnemonic: "RBX_FINDFIRSTCHILDOFCLASS", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("FindFirstChildOfClass")), args: [R(c.get("C")||0)] } }] },
  { op: 0x12C, mnemonic: "RBX_HTTP_GET",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("HttpService"), I("GetAsync")), args: [R(c.get("B")||0)] } }] },
  { op: 0x12D, mnemonic: "RBX_HTTP_POST",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("HttpService"), I("PostAsync")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x12E, mnemonic: "RBX_HTTP_REQUEST", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("HttpService"), I("RequestAsync")), args: [R(c.get("B")||0)] } }] },
  { op: 0x12F, mnemonic: "RBX_RANDOM",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("Random"), I("new")), args: [] } }] },
  { op: 0x130, mnemonic: "RBX_RND_NEXTINT",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("NextInteger")), args: [R(c.get("C")||0), R(c.get("D")||0)] } }] },
  { op: 0x131, mnemonic: "RBX_RND_NEXTNUM",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(R(c.get("B")||0), I("NextNumber")), args: [R(c.get("C")||0), R(c.get("D")||0)] } }] },
  { op: 0x132, mnemonic: "RBX_RND_SHUFFLE",  build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0x133, mnemonic: "RBX_RUNSERVICE",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G("RunService") }] },
  { op: 0x134, mnemonic: "RBX_RENDERSTEP",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(G("RunService"), I("RenderStepped")) }] },
  { op: 0x135, mnemonic: "RBX_HEARTBEAT",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(G("RunService"), I("Heartbeat")) }] },
  { op: 0x136, mnemonic: "RBX_STEPPED",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(G("RunService"), I("Stepped")) }] },

  // Bit32
  { op: 0x140, mnemonic: "B32_LSHIFT",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("lshift")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x141, mnemonic: "B32_RSHIFT",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("rshift")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x142, mnemonic: "B32_ARSHIFT", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("arshift")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x143, mnemonic: "B32_BAND",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("band")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x144, mnemonic: "B32_BOR",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("bor")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x145, mnemonic: "B32_BXOR",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("bxor")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x146, mnemonic: "B32_BNOT",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("bnot")), args: [R(c.get("B")||0)] } }] },
  { op: 0x147, mnemonic: "B32_EXTRACT", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("extract")), args: [R(c.get("B")||0), R(c.get("C")||0), R(c.get("D")||0)] } }] },
  { op: 0x148, mnemonic: "B32_REPLACE", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("replace")), args: [R(c.get("B")||0), R(c.get("C")||0), R(c.get("D")||0), R(0)] } }] },
  { op: 0x149, mnemonic: "B32_LROTATE", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("lrotate")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x14A, mnemonic: "B32_RROTATE", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("bit32"), I("rrotate")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },

  // OS
  { op: 0x150, mnemonic: "OS_CLOCK",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("os"), I("clock")), args: [] } }] },
  { op: 0x151, mnemonic: "OS_TIME",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("os"), I("time")), args: [] } }] },
  { op: 0x152, mnemonic: "OS_DATE",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("os"), I("date")), args: [R(c.get("B")||0)] } }] },
  { op: 0x153, mnemonic: "OS_DIFFTIME", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: Idx(G("os"), I("difftime")), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },

  // Select / Next / Pairs
  { op: 0x160, mnemonic: "SELECT",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("select"), args: [R(c.get("B")||0), G("...")] } }] },
  { op: 0x161, mnemonic: "NEXT",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("next"), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x162, mnemonic: "PAIRS",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("pairs"), args: [R(c.get("B")||0)] } }] },
  { op: 0x163, mnemonic: "IPairs",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("ipairs"), args: [R(c.get("B")||0)] } }] },
  { op: 0x164, mnemonic: "TONUMBER",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("tonumber"), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x165, mnemonic: "TOSTRING",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("tostring"), args: [R(c.get("B")||0)] } }] },
  { op: 0x166, mnemonic: "SETFENV",     build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 2, retc: 0 }] },
  { op: 0x167, mnemonic: "GETFENV",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("getfenv"), args: [R(c.get("B")||0)] } }] },
  { op: 0x168, mnemonic: "LOADSTRING",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("loadstring"), args: [R(c.get("B")||0)] } }] },
  { op: 0x169, mnemonic: "LOAD",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("load"), args: [R(c.get("B")||0)] } }] },
  { op: 0x16A, mnemonic: "RAWSET",      build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 3, retc: 0 }] },
  { op: 0x16B, mnemonic: "RAWGET",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("rawget"), args: [R(c.get("B")||0), R(c.get("C")||0)] } }] },
  { op: 0x16C, mnemonic: "RAWLEN",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("rawlen"), args: [R(c.get("B")||0)] } }] },
  { op: 0x16D, mnemonic: "COLLECTGARBAGE", build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0x16E, mnemonic: "ERROR",       build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },
  { op: 0x16F, mnemonic: "PRINT",       build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: 1, retc: 0 }] },

  // Environment / Globals
  { op: 0x170, mnemonic: "GETENV",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: G("_G") }] },
  { op: 0x171, mnemonic: "SETENV",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x172, mnemonic: "NEWENV",      build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I({}) }] },

  // Iterator state
  { op: 0x180, mnemonic: "ITER_INIT",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x181, mnemonic: "ITER_NEXT",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: R(c.get("B")||0), args: [R(c.get("C")||0), R(c.get("D")||0)] } }] },
  { op: 0x182, mnemonic: "ITER_STATE",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },

  // Meta methods
  { op: 0x190, mnemonic: "META_ADD",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("+", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x191, mnemonic: "META_SUB",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("-", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x192, mnemonic: "META_MUL",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("*", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x193, mnemonic: "META_DIV",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("/", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x194, mnemonic: "META_MOD",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("%", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x195, mnemonic: "META_POW",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("^", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x196, mnemonic: "META_UNM",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("-", R(c.get("B")||0)) }] },
  { op: 0x197, mnemonic: "META_LEN",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Un("#", R(c.get("B")||0)) }] },
  { op: 0x198, mnemonic: "META_CONCAT", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("..", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x199, mnemonic: "META_EQ",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("==", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x19A, mnemonic: "META_LT",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x19B, mnemonic: "META_LE",     build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("<=", R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x19C, mnemonic: "META_INDEX",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x19D, mnemonic: "META_NEWINDEX", build: (v,c,k,r) => [{ kind: "kstore", obj: R(c.get("A")||0), key: R(c.get("B")||0), val: R(c.get("C")||0) }] },
  { op: 0x19E, mnemonic: "META_CALL",   build: (v,c,k,r) => [{ kind: "callstmt", base: c.get("A")||0, argc: c.get("B")||0, retc: c.get("C")||0 }] },
  { op: 0x19F, mnemonic: "META_TOSTRING", build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: { k: "call", fn: G("tostring"), args: [R(c.get("B")||0)] } }] },

  // VM dispatch helpers
  { op: 0x1A0, mnemonic: "DISPATCH",    build: (v,c,k,r) => [{ kind: "comment", text: "dispatch" }] },
  { op: 0x1A1, mnemonic: "FETCH",       build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Idx(R(c.get("B")||0), R(c.get("C")||0)) }] },
  { op: 0x1A2, mnemonic: "DECODE_OP",   build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("&", R(c.get("B")||0), I(0xFF)) }] },
  { op: 0x1A3, mnemonic: "DECODE_A",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("&", Bin(">>", R(c.get("B")||0), I(8)), I(0xFF)) }] },
  { op: 0x1A4, mnemonic: "DECODE_B",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("&", Bin(">>", R(c.get("B")||0), I(16)), I(0xFF)) }] },
  { op: 0x1A5, mnemonic: "DECODE_C",    build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("&", Bin(">>", R(c.get("B")||0), I(24)), I(0xFF)) }] },
  { op: 0x1A6, mnemonic: "ENCODE_ABC",  build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: Bin("|", Bin("|", Bin("|", R(c.get("B")||0), Bin("<<", R(c.get("C")||0), I(8))), Bin("<<", R(c.get("D")||0), I(16))), Bin("<<", I(0), I(24))) }] },
  { op: 0x1A7, mnemonic: "SWAP",        build: (v,c,k,r) => [
    { kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) },
    { kind: "assign", reg: c.get("B")||0, src: R(c.get("A")||0) }
  ]},
  { op: 0x1A8, mnemonic: "DUP",         build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x1A9, mnemonic: "DROP",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I(null) }] },
  { op: 0x1AA, mnemonic: "PICK",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x1AB, mnemonic: "ROLL",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x1AC, mnemonic: "OVER",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x1AD, mnemonic: "ROT",         build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x1AE, mnemonic: "PUSH",        build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: R(c.get("B")||0) }] },
  { op: 0x1AF, mnemonic: "POP",         build: (v,c,k,r) => [{ kind: "assign", reg: c.get("A")||0, src: I(null) }] },
];

const RULE_MAP = new Map<number, OpcodeRule>();
for (const r of RULES) RULE_MAP.set(r.op, r);

export function liftInstruction(op: number, vip: number, cols: Map<string, number>, consts: Map<number, unknown>, regCount: number): IRStmt[] {
  const rule = RULE_MAP.get(op);
  if (!rule) return [{ kind: "comment", text: "OP_" + op }];
  return rule.build(vip, cols, consts, regCount);
}

export function getMnemonic(op: number): string {
  return RULE_MAP.get(op)?.mnemonic || ("OP_" + op);
}

export { RULES, RULE_MAP };
