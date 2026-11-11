import test from 'node:test';
import assert from 'node:assert/strict';
import {currentScanQueue} from '../lib/invoice-intake.mjs';

test('superseded un-downloaded scans do not block the current saved version',()=>{
 const old={id:'old',drive_file_id:'scan',source_version:'2',status:'queued'};
 const current={id:'current',drive_file_id:'scan',source_version:'3',staged_path:'current/scan.pdf',status:'needs_review'};
 assert.deepEqual(currentScanQueue([current,old]),[current]);
 assert.deepEqual(currentScanQueue([old,current]),[current]);
 assert.deepEqual(currentScanQueue([old]),[old]);
});
test('saved and imported versions are preserved; other files and int64 versions stay distinct',()=>{
 const saved={id:'saved',drive_file_id:'a',source_version:'1',staged_path:'saved/scan.pdf'};
 const imported={id:'imported',drive_file_id:'a',source_version:'2',document_id:'doc'};
 const newest={id:'new',drive_file_id:'a',source_version:'9007199254740993'};
 const old={id:'old',drive_file_id:'a',source_version:'9007199254740992'};
 const other={id:'other',drive_file_id:'b',source_version:'1'};
 assert.deepEqual(currentScanQueue([saved,old,imported,newest,other]),[saved,imported,newest,other]);
});
test('deleted latest entries never resurrect older queue entries, and unknown versions are not discarded',()=>{
 const old={drive_file_id:'a',source_version:'2'};
 const deleted={drive_file_id:'a',source_version:'3',deleted_at:'2026-11-11'};
 const unknown={drive_file_id:'b',source_version:'undefined'};
 assert.deepEqual(currentScanQueue([old,deleted,unknown]),[unknown]);
});
