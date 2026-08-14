import * as __typia_transform__isTypeInt32 from "typia/lib/internal/_isTypeInt32";
import * as __typia_transform__assertGuard from "typia/lib/internal/_assertGuard";
import * as __typia_transform__validateReport from "typia/lib/internal/_validateReport";
import * as __typia_transform__createStandardSchema from "typia/lib/internal/_createStandardSchema";
import * as __typia_transform__isFormatEmail from "typia/lib/internal/_isFormatEmail";
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
export interface TypiaSimple {
    id: number & tags.Type<"int32">;
    name: string;
}
export type TypiaUsers = TypiaUser[];
export const isSimple = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && __typia_transform__isTypeInt32._isTypeInt32(input.id) && "string" === typeof input.name; return (input: any): input is TypiaSimple => "object" === typeof input && null !== input && _io0(input); })();
export const assertSimple = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && __typia_transform__isTypeInt32._isTypeInt32(input.id) && "string" === typeof input.name; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "number & Type<\"int32\">",
    value: input.id
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "(number & Type<\"int32\">)",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "string",
    value: input.name
}, _errorFactory)); const __is = (input: any): input is TypiaSimple => "object" === typeof input && null !== input && _io0(input); let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): TypiaSimple => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "TypiaSimple",
            value: input
        }, _errorFactory)) && _ao0(input, _path + "", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "TypiaSimple",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; })();
export const validateSimple = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && __typia_transform__isTypeInt32._isTypeInt32(input.id) && "string" === typeof input.name; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || _report(_exceptionable, {
        path: _path + ".id",
        expected: "number & Type<\"int32\">",
        value: input.id
    })) || _report(_exceptionable, {
        path: _path + ".id",
        expected: "(number & Type<\"int32\">)",
        value: input.id
    }), "string" === typeof input.name || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string",
        value: input.name
    })].every((flag: boolean) => flag); const __is = (input: any): input is TypiaSimple => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; return __typia_transform__createStandardSchema._createStandardSchema((input: any): import("typia").IValidation<TypiaSimple> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaSimple",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaSimple",
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
export const assertParseSimple = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && __typia_transform__isTypeInt32._isTypeInt32(input.id) && "string" === typeof input.name; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "number & Type<\"int32\">",
    value: input.id
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "(number & Type<\"int32\">)",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "string",
    value: input.name
}, _errorFactory)); const __is = (input: any): input is TypiaSimple => "object" === typeof input && null !== input && _io0(input); let _errorFactory: any; const __assert = (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): TypiaSimple => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "",
            expected: "TypiaSimple",
            value: input
        }, _errorFactory)) && _ao0(input, _path + "", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "",
            expected: "TypiaSimple",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; return (input: string, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): import("typia").Primitive<TypiaSimple> => __assert(JSON.parse(input), errorFactory) as any; })();
export const validateParseSimple = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && __typia_transform__isTypeInt32._isTypeInt32(input.id) && "string" === typeof input.name; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || _report(_exceptionable, {
        path: _path + ".id",
        expected: "number & Type<\"int32\">",
        value: input.id
    })) || _report(_exceptionable, {
        path: _path + ".id",
        expected: "(number & Type<\"int32\">)",
        value: input.id
    }), "string" === typeof input.name || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string",
        value: input.name
    })].every((flag: boolean) => flag); const __is = (input: any): input is TypiaSimple => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaSimple> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaSimple",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaSimple",
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
}; return (input: string): import("typia").IValidation<import("typia").Primitive<TypiaSimple>> => __validate(JSON.parse(input)) as any; })();
export const isUser = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; return (input: any): input is TypiaUser => "object" === typeof input && null !== input && _io0(input); })();
export const assertUser = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "number & Type<\"int32\">",
    value: input.id
}, _errorFactory)) && (0 < input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "number & ExclusiveMinimum<0>",
    value: input.id
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "(number & Type<\"int32\"> & ExclusiveMinimum<0>)",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name && (2 <= input.name.length || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "string & MinLength<2>",
    value: input.name
}, _errorFactory)) && (input.name.length <= 64 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "string & MaxLength<64>",
    value: input.name
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "(string & MinLength<2> & MaxLength<64>)",
    value: input.name
}, _errorFactory)) && ("string" === typeof input.email && (__typia_transform__isFormatEmail._isFormatEmail(input.email) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".email",
    expected: "string & Format<\"email\">",
    value: input.email
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".email",
    expected: "(string & Format<\"email\">)",
    value: input.email
}, _errorFactory)) && ("boolean" === typeof input.active || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".active",
    expected: "boolean",
    value: input.active
}, _errorFactory)) && ((Array.isArray(input.tags) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && ((input.tags.length <= 8 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags",
    expected: "Array<> & MaxItems<8>",
    value: input.tags
}, _errorFactory)) && input.tags.every((elem: any, _index2: number) => "string" === typeof elem || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags[" + _index2 + "]",
    expected: "string",
    value: elem
}, _errorFactory))) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && (("object" === typeof input.profile && null !== input.profile || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)) && _ao1(input.profile, _path + ".profile", true && _exceptionable) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)); const _ao1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "number & Type<\"int32\">",
    value: input.age
}, _errorFactory)) && (0 <= input.age || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "number & Minimum<0>",
    value: input.age
}, _errorFactory)) && (input.age <= 150 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "number & Maximum<150>",
    value: input.age
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "(number & Type<\"int32\"> & Minimum<0> & Maximum<150>)",
    value: input.age
}, _errorFactory)) && ("number" === typeof input.score || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".score",
    expected: "number",
    value: input.score
}, _errorFactory)); const __is = (input: any): input is TypiaUser => "object" === typeof input && null !== input && _io0(input); let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): TypiaUser => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "TypiaUser",
            value: input
        }, _errorFactory)) && _ao0(input, _path + "", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "TypiaUser",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; })();
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
export const isUsers = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; return (input: any): input is TypiaUsers => Array.isArray(input) && input.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem)); })();
export const assertUsers = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "number & Type<\"int32\">",
    value: input.id
}, _errorFactory)) && (0 < input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "number & ExclusiveMinimum<0>",
    value: input.id
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".id",
    expected: "(number & Type<\"int32\"> & ExclusiveMinimum<0>)",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name && (2 <= input.name.length || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "string & MinLength<2>",
    value: input.name
}, _errorFactory)) && (input.name.length <= 64 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "string & MaxLength<64>",
    value: input.name
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".name",
    expected: "(string & MinLength<2> & MaxLength<64>)",
    value: input.name
}, _errorFactory)) && ("string" === typeof input.email && (__typia_transform__isFormatEmail._isFormatEmail(input.email) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".email",
    expected: "string & Format<\"email\">",
    value: input.email
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".email",
    expected: "(string & Format<\"email\">)",
    value: input.email
}, _errorFactory)) && ("boolean" === typeof input.active || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".active",
    expected: "boolean",
    value: input.active
}, _errorFactory)) && ((Array.isArray(input.tags) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && ((input.tags.length <= 8 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags",
    expected: "Array<> & MaxItems<8>",
    value: input.tags
}, _errorFactory)) && input.tags.every((elem: any, _index4: number) => "string" === typeof elem || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags[" + _index4 + "]",
    expected: "string",
    value: elem
}, _errorFactory))) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && (("object" === typeof input.profile && null !== input.profile || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)) && _ao1(input.profile, _path + ".profile", true && _exceptionable) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)); const _ao1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "number & Type<\"int32\">",
    value: input.age
}, _errorFactory)) && (0 <= input.age || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "number & Minimum<0>",
    value: input.age
}, _errorFactory)) && (input.age <= 150 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "number & Maximum<150>",
    value: input.age
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".age",
    expected: "(number & Type<\"int32\"> & Minimum<0> & Maximum<150>)",
    value: input.age
}, _errorFactory)) && ("number" === typeof input.score || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.createAssert",
    path: _path + ".score",
    expected: "number",
    value: input.score
}, _errorFactory)); const __is = (input: any): input is TypiaUsers => Array.isArray(input) && input.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem)); let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): TypiaUsers => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => (Array.isArray(input) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "TypiaUsers",
            value: input
        }, _errorFactory)) && input.every((elem: any, _index3: number) => ("object" === typeof elem && null !== elem || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        }, _errorFactory)) && _ao0(elem, _path + "[" + _index3 + "]", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        }, _errorFactory)) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "TypiaUsers",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; })();
export const validateUsers = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || _report(_exceptionable, {
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
    })) && input.tags.map((elem: any, _index4: number) => "string" === typeof elem || _report(_exceptionable, {
        path: _path + ".tags[" + _index4 + "]",
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
    })].every((flag: boolean) => flag); const __is = (input: any): input is TypiaUsers => Array.isArray(input) && input.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem)); let errors: any; let _report: any; return __typia_transform__createStandardSchema._createStandardSchema((input: any): import("typia").IValidation<TypiaUsers> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => (Array.isArray(input) || _report(true, {
            path: _path + "",
            expected: "TypiaUsers",
            value: input
        })) && input.map((elem: any, _index3: number) => ("object" === typeof elem && null !== elem || _report(true, {
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        })) && _vo0(elem, _path + "[" + _index3 + "]", true) || _report(true, {
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        })).every((flag: boolean) => flag) || _report(true, {
            path: _path + "",
            expected: "TypiaUsers",
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
export const assertParseUser = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "number & Type<\"int32\">",
    value: input.id
}, _errorFactory)) && (0 < input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "number & ExclusiveMinimum<0>",
    value: input.id
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "(number & Type<\"int32\"> & ExclusiveMinimum<0>)",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name && (2 <= input.name.length || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "string & MinLength<2>",
    value: input.name
}, _errorFactory)) && (input.name.length <= 64 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "string & MaxLength<64>",
    value: input.name
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "(string & MinLength<2> & MaxLength<64>)",
    value: input.name
}, _errorFactory)) && ("string" === typeof input.email && (__typia_transform__isFormatEmail._isFormatEmail(input.email) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".email",
    expected: "string & Format<\"email\">",
    value: input.email
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".email",
    expected: "(string & Format<\"email\">)",
    value: input.email
}, _errorFactory)) && ("boolean" === typeof input.active || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".active",
    expected: "boolean",
    value: input.active
}, _errorFactory)) && ((Array.isArray(input.tags) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && ((input.tags.length <= 8 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags",
    expected: "Array<> & MaxItems<8>",
    value: input.tags
}, _errorFactory)) && input.tags.every((elem: any, _index2: number) => "string" === typeof elem || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags[" + _index2 + "]",
    expected: "string",
    value: elem
}, _errorFactory))) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && (("object" === typeof input.profile && null !== input.profile || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)) && _ao1(input.profile, _path + ".profile", true && _exceptionable) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)); const _ao1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "number & Type<\"int32\">",
    value: input.age
}, _errorFactory)) && (0 <= input.age || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "number & Minimum<0>",
    value: input.age
}, _errorFactory)) && (input.age <= 150 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "number & Maximum<150>",
    value: input.age
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "(number & Type<\"int32\"> & Minimum<0> & Maximum<150>)",
    value: input.age
}, _errorFactory)) && ("number" === typeof input.score || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".score",
    expected: "number",
    value: input.score
}, _errorFactory)); const __is = (input: any): input is TypiaUser => "object" === typeof input && null !== input && _io0(input); let _errorFactory: any; const __assert = (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): TypiaUser => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "",
            expected: "TypiaUser",
            value: input
        }, _errorFactory)) && _ao0(input, _path + "", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "",
            expected: "TypiaUser",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; return (input: string, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): import("typia").Primitive<TypiaUser> => __assert(JSON.parse(input), errorFactory) as any; })();
export const validateParseUser = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || _report(_exceptionable, {
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
    })].every((flag: boolean) => flag); const __is = (input: any): input is TypiaUser => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaUser> => {
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
}; return (input: string): import("typia").IValidation<import("typia").Primitive<TypiaUser>> => __validate(JSON.parse(input)) as any; })();
export const assertParseUsers = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "number & Type<\"int32\">",
    value: input.id
}, _errorFactory)) && (0 < input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "number & ExclusiveMinimum<0>",
    value: input.id
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".id",
    expected: "(number & Type<\"int32\"> & ExclusiveMinimum<0>)",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name && (2 <= input.name.length || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "string & MinLength<2>",
    value: input.name
}, _errorFactory)) && (input.name.length <= 64 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "string & MaxLength<64>",
    value: input.name
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".name",
    expected: "(string & MinLength<2> & MaxLength<64>)",
    value: input.name
}, _errorFactory)) && ("string" === typeof input.email && (__typia_transform__isFormatEmail._isFormatEmail(input.email) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".email",
    expected: "string & Format<\"email\">",
    value: input.email
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".email",
    expected: "(string & Format<\"email\">)",
    value: input.email
}, _errorFactory)) && ("boolean" === typeof input.active || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".active",
    expected: "boolean",
    value: input.active
}, _errorFactory)) && ((Array.isArray(input.tags) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && ((input.tags.length <= 8 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags",
    expected: "Array<> & MaxItems<8>",
    value: input.tags
}, _errorFactory)) && input.tags.every((elem: any, _index4: number) => "string" === typeof elem || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags[" + _index4 + "]",
    expected: "string",
    value: elem
}, _errorFactory))) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".tags",
    expected: "(Array<string> & MaxItems<8>)",
    value: input.tags
}, _errorFactory)) && (("object" === typeof input.profile && null !== input.profile || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)) && _ao1(input.profile, _path + ".profile", true && _exceptionable) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".profile",
    expected: "__type",
    value: input.profile
}, _errorFactory)); const _ao1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "number & Type<\"int32\">",
    value: input.age
}, _errorFactory)) && (0 <= input.age || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "number & Minimum<0>",
    value: input.age
}, _errorFactory)) && (input.age <= 150 || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "number & Maximum<150>",
    value: input.age
}, _errorFactory)) || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".age",
    expected: "(number & Type<\"int32\"> & Minimum<0> & Maximum<150>)",
    value: input.age
}, _errorFactory)) && ("number" === typeof input.score || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.createAssertParse",
    path: _path + ".score",
    expected: "number",
    value: input.score
}, _errorFactory)); const __is = (input: any): input is TypiaUsers => Array.isArray(input) && input.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem)); let _errorFactory: any; const __assert = (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): TypiaUsers => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => (Array.isArray(input) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "",
            expected: "TypiaUsers",
            value: input
        }, _errorFactory)) && input.every((elem: any, _index3: number) => ("object" === typeof elem && null !== elem || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        }, _errorFactory)) && _ao0(elem, _path + "[" + _index3 + "]", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        }, _errorFactory)) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.createAssertParse",
            path: _path + "",
            expected: "TypiaUsers",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; return (input: string, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): import("typia").Primitive<TypiaUsers> => __assert(JSON.parse(input), errorFactory) as any; })();
export const validateParseUsers = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) && 0 < input.id) && ("string" === typeof input.name && (2 <= input.name.length && input.name.length <= 64)) && ("string" === typeof input.email && __typia_transform__isFormatEmail._isFormatEmail(input.email)) && "boolean" === typeof input.active && (Array.isArray(input.tags) && (input.tags.length <= 8 && input.tags.every((elem: any) => "string" === typeof elem))) && ("object" === typeof input.profile && null !== input.profile && _io1(input.profile)); const _io1 = (input: any): boolean => "number" === typeof input.age && (__typia_transform__isTypeInt32._isTypeInt32(input.age) && 0 <= input.age && input.age <= 150) && "number" === typeof input.score; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id && (__typia_transform__isTypeInt32._isTypeInt32(input.id) || _report(_exceptionable, {
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
    })) && input.tags.map((elem: any, _index4: number) => "string" === typeof elem || _report(_exceptionable, {
        path: _path + ".tags[" + _index4 + "]",
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
    })].every((flag: boolean) => flag); const __is = (input: any): input is TypiaUsers => Array.isArray(input) && input.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem)); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaUsers> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => (Array.isArray(input) || _report(true, {
            path: _path + "",
            expected: "TypiaUsers",
            value: input
        })) && input.map((elem: any, _index3: number) => ("object" === typeof elem && null !== elem || _report(true, {
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        })) && _vo0(elem, _path + "[" + _index3 + "]", true) || _report(true, {
            path: _path + "[" + _index3 + "]",
            expected: "TypiaUser",
            value: elem
        })).every((flag: boolean) => flag) || _report(true, {
            path: _path + "",
            expected: "TypiaUsers",
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
}; return (input: string): import("typia").IValidation<import("typia").Primitive<TypiaUsers>> => __validate(JSON.parse(input)) as any; })();
