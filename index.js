const fs = require("fs");
const path = require("path");
const generateBMFont = require("msdf-bmfont-xml");
const opentype = require("opentype.js");
const Jimp = require("jimp");

const NAMESPACE = "_GEN_ATLAS";

class GenAtlas {
  #opt
  #pngPath
  #jsonPath
  #generated

  /**
   * 
   * @param {Object} opt - The options for the constructor.
   */
  constructor(opt) {
    // Required
    this.__fonts = this.#getFonts(opt.fonts);

    // Optional
    this.__fieldType = this.#getFieldType(opt.fieldType);
    this.__outputDir = this.#getOutputDir(opt.outputDir);
    this.__textureSize = opt.textureSize
    this.__fileName = opt.fileName ?? "atlas";
    // this.__smartSize = opt.smartSize ?? true;
    this.#generated = false;

    this.#pngPath = path.join(this.__outputDir, `${this.__fileName}.${this.__fieldType}.png`);
    this.#jsonPath = path.join(this.__outputDir, `${this.__fileName}.${this.__fieldType}.json`);

    this.#opt = {
      filename: this.__fileName,
      vector: false,
      reuse: true,
      pot: false,
      square: false,
      rot: false,
      rtl: true,
      fieldType: this.__fieldType,
      outputType: "json",
      textureSize: [450 * this.__fonts.length, 450 * this.__fonts.length],
      smartSize: false,
    };
  }

  #genBMFont(fontPath, opt) {
    return new Promise((resolve, reject) => {
      generateBMFont(fontPath, opt, (error, textures, fontData) => {
        if (error) reject(error);
        resolve({ textures, fontData });
      })
    })
  }

  #getFieldType(fieldType) {
    if (!fieldType) return "sdf";
    const validFieldType = ["sdf", "msdf", "mtsdf", "psdf"];
    if (!validFieldType.includes(fieldType)) throw Error(`"fieldType" only accept ${validFieldType.join(", ")}`);
    return fieldType;
  }

  #getOutputDir(outputDir = "./") {
    const _outputDir = path.join(process.cwd(), outputDir);
    if (!fs.existsSync(_outputDir) || !fs.lstatSync(_outputDir).isDirectory()) {
      fs.mkdirSync(_outputDir)
    }
    return _outputDir;
  }

  #checkFontWeight(fonts) {
    const validFontWeight = ["thin", "hairline", "ultralight", "extralight", "light", "normal", "regular", "medium", "semibold", "demibold", "bold", "extrabold", "ultrabold", "black", "heavy"];
    for (const [index, font] of fonts.entries()) {
      if (!font.fontWeight) throw Error(`"fontWeight" is missing in item ${index}`);
      if (!validFontWeight.includes(font.fontWeight.toLowerCase())) throw Error(`Valid font weight value is ${validFontWeight.join(", ")}`);
    }
    return true;
  }

  #checkFontExt(fonts) {
    const validFontExts = ['.ttf', '.otf', '.woff', '.woff2'];
    for (const font of fonts) {
      const fontExt = path.extname(font.url);
      if (!validFontExts.includes(fontExt)) throw Error(`Font format must be "${validFontExts.join(", ")}"`);
    }
    return true;
  }

  #getCharSet(fontPath) {
    let charset = "";
    const fontInfo = opentype.loadSync(fontPath);
    const glyphs = fontInfo.glyphs.glyphs;
    Object.keys(glyphs).forEach(key => {
      const glyph = glyphs[key];
      if (glyph.unicode) {
        charset += String.fromCodePoint(glyph.unicode);
      }
    });
    return charset;
  }

  #getFonts(fonts) {
    /**
     * fonts Array<{ fontName, fontWeight, url }>
    */
    if (!fonts) throw Error('"fonts" is required');
    if (!Array.isArray(fonts)) throw Error('"fonts" must be an Array');

    const requireKeys = ["fontName", "fontWeight", "url"];
    for (const font of fonts) {
      for (const [index, requireKey] of requireKeys.entries()) {
        if (!font.hasOwnProperty(requireKey)) throw Error(`Key ${requireKey} is missing at JSON index ${index}`);
      }
    }
    return fonts;
  }

  apply(compiler) {
    compiler.hooks.beforeCompile.tapAsync(NAMESPACE, async(_, callback) => {
      if (this.#generated) {
        callback();
        return;
      }
      const fonts = this.__fonts;
      let fontsData = {};
      let cfgPath, pngPath;

      this.#checkFontExt(fonts);
      this.#checkFontWeight(fonts);

      for (const [index, font] of fonts.entries()) {
        try {
          const { url, fontWeight, fontName } = font;

          // Get all available glyphs in font file
          const charset = this.#getCharSet(url);
          this.#opt["charset"] = charset;

          const { textures, fontData } = await this.#genBMFont(url, this.#opt);
          if (textures.length > 1) throw Error('"textSize" is not enough for single atlas. Increase it');
          textures.forEach(async (texture) => {
            pngPath = path.join(process.cwd(), `${texture.filename}.png`);
            cfgPath = path.join(process.cwd(), `${texture.filename}.cfg`);

            if (index === fonts.length - 1) {
              // Crop image if it's the last one
              const img = await Jimp.read(texture.texture);
              img
                .autocrop(0.0002, false)
                .write(pngPath);
            } else {
              fs.writeFileSync(pngPath, texture.texture);
            }
            fs.writeFileSync(cfgPath, JSON.stringify(fontData.settings, null, '\t'));
            this.#opt["reuse"] = cfgPath;
          });
          fontsData[`${fontName.toLowerCase()}_${fontWeight.toLocaleLowerCase()}`] = JSON.parse(fontData.data);
        } catch (e) {
          console.error(e);
        }
      }

      // not sure about the tick in nodejs but without settimeout, file is not removed?
      setTimeout(async () => {
        await Promise.all([
          fs.rename(pngPath, this.#pngPath, (err) => {
            if (err) console.error(err);
          }),
          fs.writeFile(this.#jsonPath, JSON.stringify(fontsData, null, '\t'), (err) => {
            if (err) console.error(err);        
          }),
          fs.rm(cfgPath, (err) => {
            if (err) console.error(err);
          })
        ]);
        this.#generated = true;
        callback();
      }, 0);
    })
  }
}

module.exports = GenAtlas;