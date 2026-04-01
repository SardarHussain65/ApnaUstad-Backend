import ImageKit from "@imagekit/nodejs";
import { getConfig } from "./env";


const config = getConfig();


const imagekit = new ImageKit({
    privateKey: config.imagekitPrivateKey,

});

export default imagekit;