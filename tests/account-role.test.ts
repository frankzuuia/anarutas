import { expect,it } from "vitest";
import { accountRole,requireAccountRole } from "../src/core/account-role";
it("accepts only the two explicit roles and never widens default access",()=>{
 for(const role of ["routes","settlement"] as const){expect(accountRole(role)).toBe(role);expect(()=>requireAccountRole(role,role)).not.toThrow();expect(()=>requireAccountRole(role,"any")).not.toThrow();}
 for(const role of [null,undefined,"","admin","any",{},1])expect(()=>accountRole(role)).toThrow("ACCOUNT_ROLE_INVALID");
 expect(()=>requireAccountRole("routes","settlement")).toThrow("ROLE_DENIED");expect(()=>requireAccountRole("settlement","routes")).toThrow("ROLE_DENIED");
});
