import {eventDatabase} from '../tests/runtime-helpers.js';
import {schemaQuery} from './runtime-schema.mjs';
const t=await eventDatabase(1);
try{await t.db.exec("set search_path=''");console.log(JSON.stringify((await t.db.query(schemaQuery)).rows[0].schema_audit));}finally{await t.close();}
