import Papa from "papaparse";

/**
 * 智能解析 CSV / TXT / TSV 报告
 * 支持 UTF-8/UTF-16 LE&BE 编码自动检测与 Tab 制表符自动分隔探测。
 */
export const detectEncodingAndParse = async (file: File): Promise<any[]> => {
  return new Promise<any[]>((resolve, reject) => {
    const blob = file.slice(0, 4);
    const reader = new FileReader();
    reader.onload = (e) => {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer);
      let encoding = "utf-8";
      if (arr[0] === 0xff && arr[1] === 0xfe) {
        encoding = "utf-16le";
      } else if (arr[0] === 0xfe && arr[1] === 0xff) {
        encoding = "utf-16be";
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: encoding,
        complete: (res) => {
          const data = res.data;
          const isTxtOrTsv = file.name.endsWith('.txt') || file.name.endsWith('.tsv');
          if (isTxtOrTsv) {
            const hasTabs = data.some(row =>
              Object.keys(row).some(k => k.includes('\t')) ||
              Object.values(row).some(v => typeof v === 'string' && v.includes('\t'))
            );
            if (hasTabs || (data.length > 0 && Object.keys(data[0]).length === 1)) {
              Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                encoding: encoding,
                delimiter: "\t",
                complete: (res2) => resolve(res2.data),
                error: (err) => reject(err)
              });
              return;
            }
          }
          resolve(data);
        },
        error: (err) => reject(err)
      });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(blob);
  });
};
