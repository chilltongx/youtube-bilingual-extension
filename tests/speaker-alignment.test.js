import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDiarization,assignFromAudio} from '../speaker-alignment.js';
const d=validateDiarization({turns:[{start:0,end:4,speaker:1},{start:4,end:8,speaker:2}],offset:10});
test('aligns anonymous voices with a video offset',()=>{const row=assignFromAudio({start:10,end:14,speaker:''},d);assert.equal(row.speaker,'自动说话人 1');assert.equal(row.speakerSource,'audio');});
test('mixed voices are marked instead of assigning the entire cue to one person',()=>{assert.equal(assignFromAudio({start:12,end:16,speaker:''},d).speaker,'多人／待拆分');});
test('human labels and explicit unknowns survive reprocessing',()=>{for(const speaker of ['主持人','']){const row={start:10,end:14,speaker,speakerSource:'manual'};assert.deepEqual(assignFromAudio(row,d),row);}});
test('silence and out-of-range cues stay unassigned',()=>{assert.equal(assignFromAudio({start:20,end:24,speaker:''},d).speaker,'');});
test('malformed speaker turns are rejected',()=>{assert.throws(()=>validateDiarization({turns:[{start:0,end:-1,speaker:1}]}));});
test('AI剪口播 word timing remains audio-relative while labels use video offset',async()=>{
  const {alignTranscription}=await import('../speaker-alignment.js');
  const raw={metadata:{model:'small.en',language:'en'},words:[{text:'hello',start:0,end:1,isGap:false},{text:'',start:1,end:2,isGap:true}],segments:[{text:'hello',start:0,end:1,words:[{word:'hello',start:0,end:1}]}]};
  const out=alignTranscription(raw,d);
  assert.equal(out.words[0].start,0);assert.equal(out.words[0].speaker,'自动说话人 1');assert.equal(out.words[1].speaker,'');assert.equal(out.metadata.videoOffset,10);
});
