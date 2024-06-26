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
    this.__charset = opt.charset;
    this.__fontSize = opt.fontSize ?? 42;
    this.__border = opt.border ?? 0;
    this.__distanceRange = opt.distanceRange ?? 3;
    this.__texturePadding = opt.texturePadding ?? 2;
    this.__roundDecimal = opt.roundDecimal ?? 0;
    this.__rtl = opt.rtl ?? false;

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
      rtl: this.__rtl,
      fieldType: this.__fieldType,
      outputType: "json",
      textureSize: [512 * this.__fonts.length, 512 * this.__fonts.length],
      smartSize: true,
      fontSize: this.__fontSize,
      border: this.__border,
      distanceRange: this.__distanceRange,
      texturePadding: this.__texturePadding,
      roundDecimal: this.__roundDecimal,
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
          this.#opt["charset"] = this.__charset ?? this.#getCharSet(url);

          const { textures, fontData } = await this.#genBMFont(url, this.#opt);
          if (textures.length > 1) throw Error('"textSize" is not enough for single atlas. Increase it');
          const texture = textures[0];
          pngPath = path.join(process.cwd(), `${texture.filename}.png`);
          cfgPath = path.join(process.cwd(), `${texture.filename}.cfg`);

          fs.writeFileSync(pngPath, texture.texture);
          fs.writeFileSync(cfgPath, JSON.stringify(fontData.settings, null, '\t'));
          
          this.#opt["reuse"] = cfgPath;
          fontsData[`${fontName.toLowerCase()}_${fontWeight.toLocaleLowerCase()}`] = JSON.parse(fontData.data);
        } catch (e) {
          console.error(e);
        }
      }

      // Update atlas width and height after crop 
      const img = (await Jimp.read(pngPath)).write(this.#pngPath);
      const scaleW = img.bitmap.width;
      const scaleH = img.bitmap.height;

      for (const fontWeight in fontsData) {
        const fontData = fontsData[fontWeight];
        fontData["common"] = {
          ...fontData["common"],
          scaleW,
          scaleH
        }
      }

      // not sure about the tick in nodejs but without settimeout, file is not removed?
      setTimeout(async () => {
        await Promise.all([
          fs.rm(pngPath, (err) => {
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