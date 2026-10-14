import { describe, expect, it } from 'vitest';
import { validateAction, validateNickname, validateStage } from './validation';
describe('网络输入边界',()=>{
  it('中文昵称保留且去空白',()=>expect(validateNickname('  访客  ')).toBe('访客'));
  it.each([null,42,'','  ','访'.repeat(17),'甲\u0000乙','甲\n乙'])('拒绝非法昵称%j',value=>expect(()=>validateNickname(value)).toThrow());
  it('复制合法行动，不保留可变原对象',()=>{const request={stageId:3,actionId:'protect',targetId:'p1'};const copy=validateAction(request);request.targetId='p2';expect(copy.targetId).toBe('p1');});
  it('阶段消息只接收阶段编号',()=>{expect(validateStage({stageId:1})).toEqual({stageId:1});expect(()=>validateStage({stageId:1,playerId:'victim'})).toThrow('不允许');});
  it.each([{playerId:'victim'},{role:'monster'},{exposure:3},{kind:'host'},{round:1},{itemId:'coin'},{read:true}])('拒绝伪造状态%j',forged=>expect(()=>validateAction({stageId:3,actionId:'resist',...forged})).toThrow('不允许'));
  it.each([null,[],'resist',{stageId:0,actionId:'resist'},{stageId:'3',actionId:'resist'},{stageId:NaN,actionId:'resist'},{stageId:Infinity,actionId:'resist'},{stageId:2.5,actionId:'resist'},{stageId:3,actionId:'__proto__'},{stageId:3,actionId:'x'.repeat(65)},{stageId:3,actionId:'protect',targetId:''},{stageId:3,actionId:'protect',targetId:[]},{stageId:3,actionId:'protect',targetId:'x'.repeat(129)}])('拒绝无法解码的载荷%j',value=>expect(()=>validateAction(value)).toThrow());
});
