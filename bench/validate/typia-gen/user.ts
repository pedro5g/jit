import * as __typia_transform__isTypeInt32 from "typia/lib/internal/_isTypeInt32";
import * as __typia_transform__isFormatEmail from "typia/lib/internal/_isFormatEmail";
import * as __typia_transform__validateReport from "typia/lib/internal/_validateReport";
import * as __typia_transform__createStandardSchema from "typia/lib/internal/_createStandardSchema";
import { type tags } from "typia";
/**
 * Mirror of the JIT bench UserSchema with typia tags — same constraints,
 * so the `typia generate` output is a fair AOT-vs-AOT comparison.
 */
export interface TypiaUser {
    id: number & tags.Type<"int32"> & tags.ExclusiveMinimum<0>;
    name: string & tags.MinLength<2> & tags.MaxLength<64>;
    email: string & tags.Format<"email">;
    active: boolean;
    tags: string[] & tags.MaxItems<8>;
    profile: {
        age: number & tags.Type<"int32"> & tags.Minimum<0> & tags.Maximum<150>;
        score: number;
    };
}
export const isUser = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; return (input: any): input is TypiaUser => "object" === typeof input && null !== input && _io0(input); })();
export const validateUser = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || _report(_exceptionable, {
        path: _path + ".id",
        expected: "number & Type<\"int32\">",
        value: input.id
    })) && (0 < input.id || _report(_exceptionable, {
        path: _path + ".id",
        expected: "number & ExclusiveMinimum<0>",
        value: input.id
    })) || _report(_exceptionable, {
        path: _path + ".id",
        expected: "(number & Type<\"int32\"> & ExclusiveMinimum<0>)",
        value: input.id
    }), "string" === typeof input.name && (2 <= input.name.length || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MinLength<2>",
        value: input.name
    })) && (input.name.length <= 64 || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MaxLength<64>",
        value: input.name
    })) || _report(_exceptionable, {
        path: _path + ".name",
        expected: "(string & MinLength<2> & MaxLength<64>)",
        value: input.name
    }), "string" === typeof input.email && (__typia_transform__isFormatEmail._isFormatEmail(input.email) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "string & Format<\"email\">",
        value: input.email
    })) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "(string & Format<\"email\">)",
        value: input.email
    }), "boolean" === typeof input.active || _report(_exceptionable, {
        path: _path + ".active",
        expected: "boolean",
        value: input.active
    }), (Array.isArray(input.tags) || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "(Array<string> & MaxItems<8>)",
        value: input.tags
    })) && ((input.tags.length <= 8 || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "Array<> & MaxItems<8>",
        value: input.tags
    })) && input.tags.map((elem: any, _index2: number) => "string" === typeof elem || _report(_exceptionable, {
        path: _path + ".tags[" + _index2 + "]",
        expected: "string",
        value: elem
    })).every((flag: boolean) => flag)) || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "(Array<string> & MaxItems<8>)",
        value: input.tags
    }), ("object" === typeof input.profile && null !== input.profile || _report(_exceptionable, {
        path: _path + ".profile",
        expected: "__type",
        value: input.profile
    })) && _vo1(input.profile, _path + ".profile", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".profile",
        expected: "__type",
        value: input.profile
    })].every((flag: boolean) => flag); const _vo1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Type<\"int32\">",
        value: input.age
    })) && (0 <= input.age || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Minimum<0>",
        value: input.age
    })) && (input.age <= 150 || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Maximum<150>",
        value: input.age
    })) || _report(_exceptionable, {
        path: _path + ".age",
        expected: "(number & Type<\"int32\"> & Minimum<0> & Maximum<150>)",
        value: input.age
    }), "number" === typeof input.score || _report(_exceptionable, {
        path: _path + ".score",
        expected: "number",
        value: input.score
    })].every((flag: boolean) => flag); const __is = (input: any): input is TypiaUser => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; return __typia_transform__createStandardSchema._createStandardSchema((input: any): import("typia").IValidation<TypiaUser> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaUser",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaUser",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}); })();
