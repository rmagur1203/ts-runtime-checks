import type { Assert, ExactProps } from "../../../dist/index";
import { call } from "../../utils";
import { expect } from "chai";

describe("Matches", () => {
    describe("Assert", () => {
        describe("In function parameters", () => {
            function test(a: Assert<ExactProps<{a: string, b: number, c?: string}>>) {
                return a;
            }

            it("Throw when there are excessive properties", () => {
                expect(call(test, {a: "a", b: 234, d: 33})).to.throw("Property a[d] is excessive.");
            });
    
            it("Not throw when there aren't excessive properties", () => {
                expect(call(test, {a: "a", b: 2345, c: "b"})).to.not.throw();
            });
    
            function test2(a: Assert<ExactProps<{a: ExactProps<{b: string}>}>>) {
                return a;
            }
    
            it("Throw when excessive nested properties", () => {
                expect(call(test2, { a: { b: "c2", c: 12 }})).to.throw("Property a.a[c] is excessive.");
            });

            it("Not throw when excessive nested properties", () => {
                expect(call(test2, { a: { b: "c2" }})).to.not.throw();
            });
    
        });
    });
});