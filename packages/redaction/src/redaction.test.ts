import {describe,it,expect} from "vitest"; import {Redactor} from "./index";
describe("redaction",()=>{it("removes secrets",()=>{const r=new Redactor();expect(r.headers({Authorization:"Bearer secret"}).Authorization).toBe("[REDACTED]");expect(r.url("https://x.test/a?token=abc")).not.toContain("abc");expect(JSON.stringify(r.value({password:"MySecret123"}))).not.toContain("MySecret123")})});
