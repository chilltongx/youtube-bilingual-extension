import {renderPublication} from '../blog-publication.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
try{process.stdout.write(JSON.stringify(await renderPublication(JSON.parse(input))));}catch(e){process.stderr.write(e.message);process.exitCode=1;}
