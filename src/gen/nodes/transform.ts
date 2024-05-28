import {NodeGenContext, createContext, error, fullValidate} from ".";
import {Transformer} from "../../transformer";
import {genCheckCtx} from "../../utils";
import {getUnionMembers} from "../../utils/unions";
import {UNDEFINED, _access, _and, _assign, _bin, _call, _for, _ident, _if, _if_chain, _obj, _stmt, _str, _var} from "../expressionUtils";
import {TransformTypeData, TypeDataKinds, Validator} from "../validators";
import ts from "typescript";
import {genConciseNode} from "./match";

export interface TransformCtx {
    transformer: Transformer;
    origin: ts.Node;
    validate?: NodeGenContext;
}

export function genTransform(validator: Validator, target: ts.Expression, ctx: TransformCtx, validate: NodeGenContext | false | undefined = ctx.validate): ts.Statement[] {
    const assignTarget = validator.parent && validator.name !== "" ? _access(target, validator.name) : target;

    switch (validator.typeData.kind) {
        case TypeDataKinds.Transform: {
            if (!validator.typeData.transformations.length) return [];
            const prevStmts: ts.Statement[] = [];
            if (validate) prevStmts.push(...fullValidate(validator, validate));
            let previousExp = validator.expression();
            for (let i = 0; i < validator.typeData.transformations.length; i++) {
                const code = validator.typeData.transformations[i] as string | ts.Symbol;
                if (typeof code === "string") {
                    if (i !== 0) {
                        const ident = _ident("temp");
                        const exp = ctx.transformer.stringToNode(code, genCheckCtx(ident));
                        prevStmts.push(_var(ident, previousExp, ts.NodeFlags.Const)[0]);
                        previousExp = exp;
                    } else {
                        previousExp = ctx.transformer.stringToNode(code, genCheckCtx(previousExp));
                    }
                } else {
                    const funcIdent = ctx.transformer.importSymbol(code, ctx.origin);
                    if (!funcIdent) continue;
                    previousExp = _call(funcIdent, [previousExp]);
                }
            }
            return [...prevStmts, _stmt(_assign(assignTarget, previousExp))];
        }
        case TypeDataKinds.Tuple:
        case TypeDataKinds.Object: {
            const initializer = validator.typeData.kind === TypeDataKinds.Tuple ? ts.factory.createArrayLiteralExpression() : _obj({});
            return [_stmt(_assign(assignTarget, initializer)), ...validator.children.map(child => genTransform(child, assignTarget, ctx)).flat()];
        }
        case TypeDataKinds.Array: {
            const childType = validator.children[0];
            if (!childType) return [_stmt(_assign(assignTarget, validator.expression()))];
            let index: ts.Identifier;
            if (typeof childType.name === "object") index = childType.name;
            else {
                index = _ident("i");
                childType.setName(index);
            }
            return [_stmt(_assign(assignTarget, ts.factory.createArrayLiteralExpression())), _for(validator.expression(), index, genTransform(childType, assignTarget, ctx))[0]];
        }
        case TypeDataKinds.Union: {
            const transforms = validator.getChildrenOfKind(TypeDataKinds.Transform);
            if (!transforms.length) return [_stmt(_assign(assignTarget, validator.expression()))];
            const bases: Validator[] = [], withoutBases: Validator[] = [];
            for (const transform of transforms) {
                const typeData = transform.typeData as TransformTypeData;
                if (typeData.rest) bases.push(typeData.rest);
                else withoutBases.push(transform);
            }
            const {normal, compound} = getUnionMembers(bases, false);
            const nodeCtx = validate || createContext(ctx.transformer, {none: true}, ctx.origin);

            let elseStmt;
            if (withoutBases.length === 1) {
                elseStmt = genTransform(withoutBases[0]!, assignTarget, ctx, false);
            } else if (validate) {
                elseStmt = error(validate, [validator, [_str("to be one of "), _str(validator.children.map(base => base.translate()).join(" | "))]]);
            } else {
                elseStmt = genTransform(bases[0]!, assignTarget, ctx, false);
            }

            let result = _if_chain(
                0,
                [...normal, ...compound].map(validator => {
                    const check = genConciseNode(validator, nodeCtx);
                    const originalTransform = transforms[bases.indexOf(validator)] as Validator;

                    return [check.condition, genTransform(originalTransform, assignTarget, ctx, false)];
                }),
                elseStmt
            ) as ts.Statement;

            const extraChecks = [];
            if (validator.canBeOfKind(TypeDataKinds.Undefined))extraChecks.push(_bin(validator.expression(), UNDEFINED, ts.SyntaxKind.ExclamationEqualsEqualsToken));
            if (validator.canBeOfKind(TypeDataKinds.Null)) extraChecks.push(_bin(validator.expression(), ts.factory.createNull(), ts.SyntaxKind.ExclamationEqualsEqualsToken));
            if (extraChecks.length) result = _if(_and(extraChecks), result);

            return [result];
        }
        default: {
            const statements: ts.Statement[] = [];
            if (ctx.validate) statements.push(...fullValidate(validator, ctx.validate));
            return [...statements, _stmt(_assign(assignTarget, validator.expression()))];
        }
    }
}
