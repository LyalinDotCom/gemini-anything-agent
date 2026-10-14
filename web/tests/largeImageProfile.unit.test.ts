import{expect,test}from'vitest';import{AGENT_PROFILES}from'../src/agentProfiles';import{largeImageTemplateInstruction,LARGE_IMAGE_AGENT_ID}from'../../shared/largeImageProfile';import{effectiveRunOptions}from'../src/state/runOptions';
test('generic context does not impose the Seuss world while selected example loads both skills',()=>{
 expect(AGENT_PROFILES['large-image'].agentId).toBe(LARGE_IMAGE_AGENT_ID);expect(AGENT_PROFILES['large-image'].managed).toBe(true);
 expect(largeImageTemplateInstruction('generic')).toContain('only the generic');expect(largeImageTemplateInstruction('seuss-world')).toContain('BOTH');
 expect(effectiveRunOptions({agentMode:'large-image'})).toMatchObject({store:true,background:true});
});
