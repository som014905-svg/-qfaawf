return (function (num1,...)
    local value1 = type(num1) == "number" and num1 or type(num1) == "string" and # num1 * 2654435761 or 2654435761;
    local tbl1 = # type(nil) * 227 + # type(true) * 151 + 7258;
    local num2 = bit32.bxor(3745153915, bit32.bxor(bit32.bxor(value1, tbl1), select("#",...) * 2246822519)) % 4294967296;
    local fn116, fn117, value2, fn118, fn119, fn120, fn121, fn122, value3, n, num3, tbl2;
    do
      local fn123;
      local tbl3;
      do
        local num4, value4 = pcall(getmetatable, "")
        if num4 and type(value4) == "table" then
          local value5 = value4.__index;
          if type(value5) == "table" then
            fn123 = value5.char
          end
        end;
        if not fn123 then
          fn123 = string and string.char
        end;
        if not fn123 then
          error("")
        end
      end;
      local tbl4 = {}
      for w = 0, 255 do
        tbl4[w] = fn123(w)
      end;
      local num5, num6 = pcall(function ()
          local fn124 = getfenv;
          if fn124 then
            return fn124(0)
          end
        end)
      if num5 and num6 then
        tbl3 = num6
      else tbl3 = {string = string, math = math, type = type, tostring = tostring, rawget = rawget, pcall = pcall, pairs = pairs, getmetatable = getmetatable, debug = debug}
      end;
      local tbl5 = {{1, 1, {199, 124, 45, 42, 112, 204}, {214, 113, 43, 38}}, {2, 1, {237, 74, 219, 18, 173, 13}, {237, 75, 203}}, {3, 0, {}, {239, 22, 135, 222, 13, 93, 6, 34, 15, 216, 108, 177}}, {4, 0, {}, {22, 205, 92, 158, 106}}, {5, 0, {}, {40, 177, 251, 87, 193, 193, 51, 137}}, {6, 1, {53, 103, 160, 51, 54, 0}, {37, 123, 179, 40}}, {7, 1, {93, 41, 104, 250}, {86, 36, 115, 253, 143}}, {8, 0, {}, {106, 31, 15, 184, 209}}, {9, 0, {}, {112, 202, 192, 103}}, {10, 0, {}, {156, 137, 141, 94, 137, 16}}, {11, 0, {}, {168, 125, 37, 29, 253}}}
      local tbl6 = {}
      for C = 1, # tbl5 do
        local tbl7 = tbl5[C]
        local tbl8 = tbl7[1]
        local str1 = ""
        local num7 = (3368190936 + tbl8 * 381148773) % 4294967296;
        for H = 1, # tbl7[4] do
          num7 = (num7 * 997247 + 3142566657) % 4294967296;
          local num8 = (num7 - num7 % 65536) / 65536 % 256;
          local tbl9 = tbl7[4][H]
          local num9 = 0;
          local num10 = 1;
          for M = 0, 7 do
            if tbl9 % 2 ~= num8 % 2 then
              num9 = num9 + num10
            end;
            tbl9 = (tbl9 - tbl9 % 2) / 2;
            num8 = (num8 - num8 % 2) / 2;
            num10 = num10 * 2
          end;
          str1 = str1..tbl4[num9]
        end;
        if tbl7[2] == 1 then
          local str2 = ""
          local num11 = (3368190936 + tbl8 * 381148773) % 4294967296;
          for P = 1, # tbl7[3] do
            num11 = (num11 * 997247 + 3142566657) % 4294967296;
            local num12 = (num11 - num11 % 65536) / 65536 % 256;
            local tbl10 = tbl7[3][P]
            local num13 = 0;
            local num14 = 1;
            for U = 0, 7 do
              if tbl10 % 2 ~= num12 % 2 then
                num13 = num13 + num14
              end;
              tbl10 = (tbl10 - tbl10 % 2) / 2;
              num12 = (num12 - num12 % 2) / 2;
              num14 = num14 * 2
            end;
            str2 = str2..tbl4[num13]
          end;
          local tbl11 = tbl3[str2]
          if tbl11 then
            tbl6[tbl7[1]] = tbl11[str1]
          end
        else tbl6[tbl7[1]] = tbl3[str1]
        end
      end;
      fn116 = tbl6[6] fn117 = tbl6[1] value2 = tbl6[2] fn118 = tbl6[7] fn119 = tbl6[9] fn120 = tbl6[5] fn121 = tbl6[10] fn122 = tbl6[11] value3 = tbl6[8] n = tbl6[3] num3 = tbl6[4]
    end;
    do
      local num15 = fn116(68)..fn116(113)..fn116(53)
      if num15 ~= "Dq5" then
        local num16 = n("")
        if num16 and type(num16) == "table" and num16.__index then
          local value6 = fn121(num16.__index, "char")
          if value6 then
            fn116 = value6
          end
        end
      end
    end;
    tbl2 = {}
    for Z = 0, 255 do
      tbl2[Z] = fn116(Z)
    end;
    local
    function fn10(tbl12, value7, value8)
      local tbl13 = {}
      local num17 = 0;
      for ag = value7, value8 do
        num17 = num17 + 1;
        tbl13[num17] = tbl2[tbl12[ag] or 0]
      end;
      while num17 > 1 do
        local num18 = 0;
        for ai = 1, num17 - 1, 2 do
          num18 = num18 + 1;
          tbl13[num18] = tbl13[ai]..tbl13[ai + 1]
        end;
        if num17 % 2 == 1 then
          num18 = num18 + 1;
          tbl13[num18] = tbl13[num17]
        end;
        for aj = num18 + 1, num17 do
          tbl13[aj] = nil
        end;
        num17 = num18
      end;
      return tbl13[1] or ""
    end;
    local fn11 = function (value9)
      return bit32.band(value9, 255)
    end;
    local fn12 = function (value10)
      return bit32.band(value10, 65535)
    end;
    local fn13 = function (value11)
      return bit32.band(value11, 31)
    end;
    local fn14 = function (num19)
      local value12 = math.floor;
      return num19 - math.floor(num19 / 4294967296) * 4294967296
    end;
    local fn15 = function (num20)
      local value13 = math.floor;
      return num20 - math.floor(num20 / 65521) * 65521
    end;
    local fn16 = function (value14)
      return bit32.band(value14, 1)
    end;
    local tbl14 = {}
    for az = 0, 255 do
      tbl14[az] = fn116(az)
    end;
    local
    function fn17(tbl15, num21, num22) num21 = num21 or 1;
      num22 = num22 or # tbl15;
      local num23 = num22 - num21 + 1;
      if num23 <= 0 then
        return ""
      end;
      local tbl16 = {}
      for aG = 1, num23 do
        tbl16[aG] = tbl15[num21 + aG - 1]
      end;
      while num23 > 1 do
        local num24 = 0;
        for aI = 1, num23 - 1, 2 do
          num24 = num24 + 1;
          tbl16[num24] = tbl16[aI]..tbl16[aI + 1]
        end;
        if num23 % 2 == 1 then
          num24 = num24 + 1;
          tbl16[num24] = tbl16[num23]
        end;
        for aJ = num24 + 1, num23 do
          tbl16[aJ] = nil
        end;
        num23 = num24
      end;
      return tbl16[1] or ""
    end;
    local
    function fn18(tbl17)
      local str3 = ""
      local num25 = 131;
      for aO, aP in next, {234, 245, 231, 243, 245, 243, 236, 226} do
        local num26 = aP;
        local num27 = 131;
        local num28 = 0;
        local num29 = 1;
        for aU = 0, 7 do
          if num26 % 2 ~= num27 % 2 then
            num28 = num28 + num29
          end;
          num26 = (num26 - num26 % 2) / 2;
          num27 = (num27 - num27 % 2) / 2;
          num29 = num29 * 2
        end;
        str3 = str3..fn116(num28)
      end;
      local value15 = tbl17[str3]
      if type(value15) ~= "string" then
        return 0
      end;
      local num30 = 2166136261;
      local value16 = math.floor;
      for aY = 1, # value15 do
        local num31 = fn117(value15, aY) + 1;
        num30 = fn14(fn12(math.floor(num30 / 65536) * 16777619) * 65536 + fn12(num30) * 16777619) num30 = fn14(num30 + num31)
      end;
      return fn14(num30)
    end;
    local tbl18 = {1091426934, 1097365580, 1103253708, 1109186877, 1115080495, 1121017842, 1126907465, 1132848067, 1138734391, 1144602291, 1150561338, 1156489354, 1162388287, 1168284200, 1174214930, 1180157358, 1186041944, 1191921426, 1197868867, 1203770337, 1209695814, 1215598269, 1221523081, 1227448143, 1233349923, 1239246608, 1245176963, 1251109432, 1257004019, 1262914073, 1268830902, 1274806217, 1280657769, 1286563867, 1292484961, 1298380409, 1304312013, 1310256128, 1316138838, 1322014290, 1327966014, 1333884760, 1339793144, 1345699171, 1351619916, 1357540041, 1363447158, 1369373493, 1375274112, 1381187337, 1387101209, 1392975634, 1398928176, 1404858250, 1410755554, 1416667434, 1422582404, 1428548862, 1434409684, 1440307639, 1446236725, 1452180779, 1458063793, 1463991818, 1469890987, 1475786441, 1481718150, 1487606912, 1493545341, 1499448964, 1505372306, 1511325667, 1517199395, 1523081507, 1529026670, 1534919719, 1540853941, 1546721606, 1552681052, 1558587101, 1564508195, 1570424509, 1576335425, 1582271357, 1588162703, 1594049519, 1599989983, 1605935502, 1611816974, 1617728904, 1623644235, 1629613767, 1635471590, 1641357349, 1647298953, 1653248204, 1659126170, 1665021793, 1670953339, 1676818720, 1682780624, 1688684720, 1694607934, 1700485219, 1706435263, 1712328610, 1718262508, 1724185891, 1730089789, 1735990905, 1741917114, 1747799529, 1753744623, 1759704100, 1765571775, 1771461766, 1777399292, 1783362049, 1789226419, 1795128363, 1801053753, 1806972299, 1812881262, 1818814022, 1824708453, 1830618613, 1836535813, 1842451004, 1848363306, 1854279517, 1860190481, 1866106759, 1872017950, 1877885384, 1883845605, 1889791174, 1895672839, 1901563148, 1907500499, 1913422507, 1919327778, 1925198141, 1931154954, 1937110225, 1942982422, 1948861541, 1954810008, 1960754489, 1966637498, 1972545315, 1978465204, 1984398060, 1990292626, 1996203311, 2002119981, 2008050570, 2013947537, 2019876686, 2025774964, 2031682209, 2037602495, 2043489550}
    for bb = 1, # tbl18 do
      local value17 = (num2 + (bb - 1) * 146 * 40503 + 37 + (bb - 1) * (bb - 1)) % 4294967296;
      tbl18[bb] = bit32.bxor(tbl18[bb], value17)
    end;
    local tbl19 = {}
    for be = 1, # tbl18, 2 do
      tbl19[tbl18[be]] = tbl18[be + 1]
    end;
    local tbl20 = (function ()
        local fn19;
        do
          local num32, num33 = pcall(getmetatable, "")
          if num32 and num33 and type(num33) == "table" then
            local fn20 = rawget;
            if not fn20 then
              fn20 = function (tbl21, value18)
                return tbl21[value18]
              end
            end;
            local value19 = fn20(num33, "__index")
            if type(value19) == "table" then
              fn19 = fn20(value19, "char")
            end
          end;
          if not fn19 then
            fn19 = string and string.char
          end;
          if not fn19 then
            error("")
          end
        end;
        local tbl22 = {}
        for bo = 0, 255 do
          tbl22[bo] = fn19(bo)
        end;
        local value20;
        do
          local num34, num35 = pcall(function ()
              return typeof
            end)
          if num34 and num35 then
            value20 = num35
          end
        end;
        local num36, num37 = pcall(function ()
            local fn21 = getfenv;
            if fn21 then
              return fn21(0)
            end
          end)
        local tbl23 = num36 and num37 or {}
        local tbl24 = {{1, {17, 130, 148, 131}}, {2, {131, 139, 159, 176, 151, 209, 47, 172, 174, 251, 79, 52, 119}}, {2, {82, 135, 155, 201, 124, 212, 212}}, {1, {244, 190, 131, 207, 43}}, {2, {166, 183, 174, 225}}, {2, {21, 177, 182, 1, 196, 69, 234}}, {1, {209, 181, 191, 42, 180, 19, 93}}, {2, {68, 164, 169, 60}}, {2, {0, 179, 166, 87, 36, 193}}, {2, {178, 182, 216, 110, 7}}, {2, {115, 220, 203}}, {2, {208, 216, 216, 132, 143, 78, 111, 30, 254, 6, 100, 36}}, {2, {164, 213, 209, 179, 94, 48, 27, 213}}, {1, {51, 202, 234, 210, 89, 246, 183, 134, 139, 251, 180, 211}}, {2, {220, 196, 251, 199, 28, 248, 80, 66, 99, 203, 209, 10, 179, 52, 15, 181, 47, 182, 137, 190, 187}}, {0, {139, 199, 242, 253, 197}}, {2, {8, 199, 234, 14, 189, 140, 199, 223, 0, 172, 189, 249}}, {2, {253, 219, 240, 2, 105, 66}}, {2, {83, 237, 17, 47, 83, 34, 230, 91, 168, 101, 63}}, {1, {20, 228, 20, 95, 26, 9}}, {1, {169, 224, 0, 106, 247, 193, 22, 207}}, {2, {127, 228, 11, 103, 190, 255}}, {1, {239, 227, 12, 148, 156, 130}}, {1, {154, 242, 42, 190, 67, 107}}, {0, {40, 9, 33, 173, 13, 47}}, {2, {245, 13, 33, 207, 240, 0, 2, 96, 138, 225, 206, 116, 149, 90, 132, 95, 19, 193, 121, 255, 78, 125}}, {2, {79, 7, 32, 228, 148, 254, 197, 51, 65, 199, 245, 190}}, {1, {29, 10, 74, 18, 156, 176, 112, 252, 53, 220, 21, 229}}, {1, {190, 9, 94, 6, 77, 130}}, {1, {75, 7, 71, 33, 56, 99}}, {2, {205, 37, 67, 86}}, {0, {149, 60, 87, 76}}, {2, {12, 47, 121, 104, 157, 218, 129, 182, 95}}, {0, {212, 60, 103, 153, 80, 200, 39, 124, 56}}, {2, {86, 55, 107, 172}}, {2, {2, 43, 116, 162}}, {2, {131, 53, 101, 192, 245, 86, 29, 162, 149, 41, 227, 170, 97, 154}}, {1, {71, 32, 141, 252, 139, 21}}, {2, {192, 120, 154, 233, 18}}, {2, {145, 93, 128, 12, 43}}, {2, {35, 82, 140, 34}}, {2, {228, 71, 167, 51, 223, 101, 42, 115, 238, 145, 117, 58, 95, 185, 220, 81, 30, 214}}, {2, {69, 79, 180, 93, 135, 66, 152, 8, 132, 140, 48, 203}}, {2, {49, 87, 184, 113, 113, 26, 100, 206, 121, 127}}, {2, {129, 73, 171, 137, 41, 230, 62, 133, 32, 78, 170}}, {2, {85, 125, 174, 129}}, {1, {226, 106, 213, 163, 196}}, {1, {149, 118, 215, 194, 133}}, {2, {7, 107, 205, 212, 123, 90, 219}}, {2, {244, 101, 203, 226, 16, 56, 45, 75, 122, 254, 1, 142, 168, 118, 252, 217, 196, 234, 46, 95, 27, 55, 150}}, {1, {100, 124, 209, 23}}, {2, {61, 96, 227, 56, 202, 215, 124, 255, 22, 198, 126, 37, 246}}, {2, {188, 140, 242, 50, 179}}, {2, {97, 130, 225, 76, 106, 132, 148, 87, 161, 171, 136, 192, 77, 209}}, {2, {220, 146, 235, 115, 46, 114}}, {2, {188, 139, 28, 116}}, {2, {14, 133, 20, 134, 215, 33, 131, 134, 33, 120, 204, 171, 206}}, {2, {222, 134, 3, 187, 167, 239}}, {2, {127, 129, 29, 208, 108, 171}}, {1, {2, 185, 27, 209}}, {1, {180, 167, 63, 239, 1, 123}}, {2, {100, 165, 48, 5, 243, 32, 180, 111, 80, 247, 68, 42, 162}}, {0, {226, 161}}, {2, {184, 172, 47, 32, 107, 253, 176, 170, 231, 219, 195, 155}}, {1, {47, 183, 51, 92, 68}}, {0, {200, 169, 78, 47, 90}}, {1, {125, 211, 64, 113, 232, 102, 204, 224}}, {2, {47, 214, 79, 139, 191}}, {1, {171, 221, 74, 187, 155, 1, 22, 108, 7, 106, 23, 77, 248, 114}}, {1, {70, 203, 104, 176, 66, 228, 185, 53}}, {2, {196, 200, 108, 203, 14, 219, 70, 221, 219, 35, 49, 241, 47, 56, 131, 55, 248, 221, 34}}, {2, {181, 202, 101, 242, 224, 183, 239, 190, 169, 34, 88, 51, 121, 218, 5, 236}}, {2, {14, 206, 121, 8, 167, 105, 131, 116}}, {0, {201, 232}}, {1, {116, 246, 138, 43, 91, 47, 254, 248}}, {1, {21, 243, 159, 69, 47}}, {0, {176, 250, 137, 25}}, {2, {84, 229, 157, 109, 168, 184}}, {3, {241, 234, 145, 146, 144, 148}}, {1, {147, 225, 168, 178}}, {2, {48, 30, 167, 177, 62, 60, 186, 109}}, {2, {212, 24, 191, 196, 250, 11, 92, 3, 193}}, {2, {80, 23, 161, 241, 212, 202, 175}}}
        for bx = 1, # tbl24 do
          local tbl25 = tbl24[bx]
          local str4 = ""
          local num38 = (3139980273 + bx * 1701260685) % 4294967296;
          for bB = 1, # tbl25[2] do
            num38 = (num38 * 71401 + 1457601016) % 4294967296;
            local num39 = (num38 - num38 % 65536) / 65536 % 256;
            local tbl26 = tbl25[2][bB]
            local num40 = 0;
            local num41 = 1;
            for bG = 0, 7 do
              if tbl26 % 2 ~= num39 % 2 then
                num40 = num40 + num41
              end;
              tbl26 = (tbl26 - tbl26 % 2) / 2;
              num39 = (num39 - num39 % 2) / 2;
              num41 = num41 * 2
            end;
            str4 = str4..tbl22[num40]
          end;
          local tbl27 = tbl25[1]
          if tbl27 == 2 then
            if value20 then
              local num42, num43 = pcall(function ()
                  return _G[str4]
                end)
              if num42 and num43 ~= nil then
                tbl23[str4] = num43
              end
            end
          elseif tbl27 == 3 then
            local value21 = _G and _G[str4]
            if not value21 then
              local num44 = tbl23;
              if num44 and num44.table then
                value21 = num44.table[str4]
              end
            end;
            if value21 then
              tbl23[str4] = value21
            end
          else
            local num45 = _G and _G[str4]
            if num45 ~= nil then
              tbl23[str4] = num45
            end
          end
        end;
        do
          local num46 = 131;
          local str5 = ""
          for bP, bQ in next, {234, 245, 231, 243, 245, 243, 236, 226} do
            local num47 = bQ;
            local num48 = 131;
            local num49 = 0;
            local num50 = 1;
            for bV = 0, 7 do
              if num47 % 2 ~= num48 % 2 then
                num49 = num49 + num50
              end;
              num47 = (num47 - num47 % 2) / 2;
              num48 = (num48 - num48 % 2) / 2;
              num50 = num50 * 2
            end;
            str5 = str5..tbl22[num49]
          end;
          local str6 = ""
          for bX, bY in next, {160, 227, 240, 200, 173, 169, 220, 183, 197, 168, 240, 212, 184, 167, 185, 216, 220, 243, 177, 223, 229, 208, 233, 168} do
            local num51 = bY;
            local num52 = 131;
            local cb = 0;
            local num53 = 1;
            for cd = 0, 7 do
              if num51 % 2 ~= num52 % 2 then
                cb = cb + num53
              end;
              num51 = (num51 - num51 % 2) / 2;
              num52 = (num52 - num52 % 2) / 2;
              num53 = num53 * 2
            end;
            str6 = str6..tbl22[cb]
          end;
          tbl23[str5] = str6
        end;
        return tbl23
      end)();
    do
      local num54 = 113503
    end;
    do
      local num55 = 982280
    end;
    local fn22;
    local tbl28 = {}
    do
      local num56 = 655575
    end;
    local num57 = 1;
    ;
    do
      local num58 = 495498
    end;
    do
      local num59 = 237208
    end;
    local tbl29 = {1091426994, 1097340305, 1103271241, 1109167281, 1115080542, 1120994220, 1126907526, 1132796828, 1138734396, 1144647704, 1150559969, 1156474819, 1162388429, 1168301823, 1174240391, 1180145460, 1186041943, 1191955462, 1197873319, 1203782625, 1209695806, 1215609381, 1221509441, 1227487907, 1233350138, 1239263464, 1245159313, 1251090304, 1257003949, 1262917599, 1268830857, 1274793801, 1280657893, 1286571461, 1292474910, 1298398435, 1304311966, 1310225456, 1316110711, 1322030056, 1327966080, 1333879306, 1339799512, 1345706578, 1351619852, 1357533466, 1363464209, 1369348339, 1375274025, 1381187786, 1387087780, 1393014705, 1398928254, 1404841752, 1410742057, 1416665206, 1422582478, 1428495964, 1434388428, 1440326892, 1446236906, 1452150311, 1458063634, 1463969286, 1469890981, 1475804646, 1481759003, 1487631778, 1493545438, 1499458869, 1505362719, 1511314135, 1517199569, 1523112983, 1529062598, 1534940408, 1540853838, 1546767493, 1552713640, 1558606429, 1564508288, 1570421773, 1576309750, 1582249209, 1588162729, 1594076250, 1599953962, 1605900275, 1611817162, 1617730714, 1623625616, 1629557890, 1635471406, 1641385314, 1647298852, 1653226108, 1659126084, 1665039707, 1670939190, 1676866991, 1682780446, 1688694275, 1694589923, 1700501034, 1706435268, 1712348880, 1718247664, 1724176211, 1730089868, 1736003531, 1741921087, 1747785799, 1753744517, 1759658001, 1765548666, 1771485423, 1777399294, 1783312690, 1789205931, 1795137514, 1801053950, 1806967506, 1812884475, 1818793235, 1824708462, 1830622349, 1836538958, 1842416575, 1848363400, 1854277060, 1860229649, 1866104559, 1872018037, 1877931951, 1883852130, 1889765840, 1895650236, 1901586466, 1907547772, 1913413996, 1919327951, 1925241505, 1931163018, 1937048410, 1942982463, 1948896283, 1954848557, 1960723769, 1966637374, 1972551257, 1978465135, 1984413184, 1990292676, 1996206263, 2002107575, 2008033545, 2013947564, 2019861489, 2025774849, 2031735668, 2037602447, 2043516381, 2049400834, 2055343646, 2061257630, 2067171417, 2073041878, 2079010417, 2084912860, 2090826398, 2096722329, 2102654191, 2108567566, 2114481488, 2120395322, 2126301211, 2132222945, 2138136794, 2144064824, 2149964048, 2155878014, 2161791949, 2167705797, 2173623004, 2179533060, 2185447081, 2191350521, 2197274649, 2203188719, 2209102589, 2214997057, 2220938976, 2226843716, 2232757556, 2238659707, 2244585360, 2250499294, 2256413124, 2262316308, 2268247684, 2274154271, 2280068337, 2285991835, 2291895866, 2297809742, 2303723586, 2309637611, 2315578053, 2321465270, 2327379066, 2333328879, 2339206881, 2345120661, 2351034461, 2356992329, 2362838640, 2368776186, 2374689809, 2380645986, 2386517687, 2392431415, 2398345573, 2404294705, 2410162230, 2416087160, 2422000989, 2427974885, 2433828785, 2439742494, 2445656610, 2451569528, 2457517247, 2463398262, 2469312111, 2475221697, 2481140010, 2487053966, 2492967790, 2498831547, 2504824986, 2510709638, 2516623594, 2522509464, 2528451285, 2534365439, 2540279080, 2546193068, 2552132124, 2558020954, 2563934902, 2569848390, 2575774531, 2581676654, 2587590711, 2593489713, 2599386752, 2605332590, 2611246365, 2617143555, 2623074535, 2628988235, 2634902366, 2640788133, 2646711574, 2652644328, 2658558092, 2664433733, 2670385938, 2676300147, 2682213946, 2688103087, 2694035056}
    for cp = 1, # tbl29 do
      local value22 = (num2 + (cp - 1) * 146 * 40503 + 37 + (cp - 1) * (cp - 1)) % 4294967296;
      tbl29[cp] = bit32.bxor(tbl29[cp], value22)
    end;
    local tbl30 = {}
    for cs = 1, # tbl29, 8 do
      tbl30[# tbl30 + 1] = {tbl29[cs], tbl29[cs + 1], tbl29[cs + 2], tbl29[cs + 3], tbl29[cs + 4], tbl29[cs + 5], tbl29[cs + 6], tbl29[cs + 7]}
    end;
    ;
    do
      local num60 = 924383
    end;
    local num61 = 0;
    ;
    do
      local num62 = 707960
    end;
    local tbl31 = {};
    do
      local num63 = 990750
    end;
    do
      local num64 = 754920415;
      for cC = 20, 34 do
        local tbl32 = tbl30[cC] num64 = (num64 * 1500007 + (tbl32[1] or 0) + 1) % 4294967296;
        num64 = (num64 * 1500007 + (tbl32[2] or 0) + 1) % 4294967296;
        num64 = (num64 * 1500007 + (tbl32[3] or 0) + 1) % 4294967296;
        num64 = (num64 * 1500007 + (tbl32[4] or 0) + 1) % 4294967296
      end;
      tbl31[5] = num64
    end;
    if num3 then
      local tbl33 = {}
      local num65;
      do
        if num3.getinfo then
          local value23 = num3.getinfo(1, "S")
          if value23 then
            num65 = value23.source
          end
        elseif num3.info then
          num65 = num3.info(1, "s")
        end
      end;
      if num3.traceback then
        tbl33.traceback = num3.traceback
      end;
      if num3.profilebegin then
        tbl33.profilebegin = num3.profilebegin
      end;
      if num3.profileend then
        tbl33.profileend = num3.profileend
      end;
      if num3.setmemorycategory then
        tbl33.setmemorycategory = num3.setmemorycategory
      end;
      if num3.resetmemorycategory then
        tbl33.resetmemorycategory = num3.resetmemorycategory
      end;
      if num3.dumpcodesize then
        tbl33.dumpcodesize = num3.dumpcodesize
      end;
      if num3.info then
        tbl33.info = function (num66, value24)
          if fn119(num66) == "number" then
            local num67 = num3.info(num66 + 1, "s")
            if num67 and num65 and num67 == num65 then
              return nil
            end;
            return num3.info(num66 + 1, value24)
          elseif fn119(num66) == "function" then
            local num68 = num3.info(num66, "s")
            if num68 and num65 and num68 == num65 then
              return nil
            end
          end;
          return num3.info(num66, value24)
        end
      end;
      if num3.getinfo then
        tbl33.getinfo = function (num69, value25)
          if fn119(num69) == "number" then
            return num3.getinfo(num69 + 1, value25)
          end;
          return num3.getinfo(num69, value25)
        end
      end;
      if num3.getlocal then
        tbl33.getlocal = function (num70, value26)
          if fn119(num70) == "number" then
            local num71;
            if num3.getinfo then
              num71 = num3.getinfo(num70 + 1, "S")
              if num71 and num65 and num71.source == num65 then
                return nil
              end
            elseif num3.info then
              num71 = num3.info(num70 + 1, "s")
              if num71 and num65 and num71 == num65 then
                return nil
              end
            end;
            return num3.getlocal(num70 + 1, value26)
          end;
          return num3.getlocal(num70, value26)
        end
      end;
      if num3.setlocal then
        tbl33.setlocal = function (num72, value27, value28)
          if fn119(num72) == "number" then
            local num73;
            if num3.getinfo then
              num73 = num3.getinfo(num72 + 1, "S")
              if num73 and num65 and num73.source == num65 then
                return nil
              end
            elseif num3.info then
              num73 = num3.info(num72 + 1, "s")
              if num73 and num65 and num73 == num65 then
                return nil
              end
            end;
            return num3.setlocal(num72 + 1, value27, value28)
          end;
          return num3.setlocal(num72, value27, value28)
        end
      end;
      if num3.getupvalue then
        tbl33.getupvalue = function (value29, value30)
          if fn119(value29) == "function" then
            local num74;
            if num3.getinfo then
              num74 = num3.getinfo(value29, "S")
              if num74 and num65 and num74.source == num65 then
                return nil
              end
            elseif num3.info then
              num74 = num3.info(value29, "s")
              if num74 and num65 and num74 == num65 then
                return nil
              end
            end
          end;
          return num3.getupvalue(value29, value30)
        end
      end;
      if num3.setupvalue then
        tbl33.setupvalue = function (value31, value32, value33)
          if fn119(value31) == "function" then
            local num75;
            if num3.getinfo then
              num75 = num3.getinfo(value31, "S")
              if num75 and num65 and num75.source == num65 then
                return nil
              end
            elseif num3.info then
              num75 = num3.info(value31, "s")
              if num75 and num65 and num75 == num65 then
                return nil
              end
            end
          end;
          return num3.setupvalue(value31, value32, value33)
        end
      end;
      if num3.gethook then
        tbl33.gethook = num3.gethook
      end;
      if num3.getmetatable then
        tbl33.getmetatable = num3.getmetatable
      end;
      if num3.setmetatable then
        tbl33.setmetatable = num3.setmetatable
      end;
      debug = tbl33;
      if tbl20 then
        tbl20.debug = tbl33
      end;
      fn122(function () rawset(tbl20, "debug", tbl33)
        end)
    end;
    local num76 = 0;
    num76 = fn12(num76 * 40 + fn117(fn120(1)) + 235) num76 = fn12(num76 * 40 + # fn119(true) + 235) num76 = fn12(num76 * 40 + # fn120(nil) + 235) num76 = fn12(num76 * 40 + # fn120(false) + 235) num76 = fn12(num76 * 40 + # fn119(0) + 235) num76 = fn12(num76 * 40 + # fn119({}) + 235) num76 = fn12(num76 * 40 + # fn120(true) + 235) num76 = fn12(num76 * 40 + # fn119("") + 235)
    local num77 = 0;
    local
    function fn23(tbl34, value34)
      local tbl35 = tbl34[value34]
      if not tbl35 then
        error("upvalue index out of range")
      end;
      if tbl35[1] == 1 then
        return tbl35[2][tbl35[3]]
      else
        return tbl35[2]
      end
    end;
    local
    function fn24(tbl36, value35, value36)
      local tbl37 = tbl36[value35]
      if not tbl37 then
        error("upvalue index out of range")
      end;
      if tbl37[1] == 1 then
        tbl37[2][tbl37[3]] = value36
      else tbl37[2] = value36
      end
    end;
    local
    function fn25(tbl38, num78)
      for dq, dr in pairs(tbl38) do
        if dr[1] == 1 and dr[3] >= num78 then
          dr[2] = dr[2][dr[3]] dr[1] = 0;
          dr[3] = nil;
          tbl38[dq] = nil
        end
      end
    end;
    local num79 = bit32.bxor(1603401183, fn18(tbl20))
    local str7 = "pqijeh"
    local tbl39 = {185, 139, 45, 243, 146, 88, 113, 18, 132, 137, 16, 155, 194, 215, 33, 181, 67, 250, 211, 39, 11, 109, 238, 107, 203, 65, 187, 233, 68, 99, 77, 63, 210, 43, 222, 75, 30, 193, 87, 116, 115, 30}
    local tbl40 = {138, 44, 122, 89, 123, 65, 82, 81, 224, 231, 213, 50, 75, 112, 152, 143, 2, 218, 228, 124, 204, 249, 0, 64, 8, 214, 237, 139, 125, 39, 112, 1, 61, 105, 99, 126, 149, 97, 235, 222, 132}
    local tbl41 = {200, 86, 183, 93, 95, 74, 214, 60, 233, 141, 125, 71, 203, 201, 51, 87, 85, 23, 96, 42, 150, 0, 215, 71, 29, 65, 40, 100, 81, 105, 192, 171, 22, 162, 170, 162, 95, 63, 189, 132, 26, 39, 117, 45, 208, 76, 79, 163, 103, 89, 215, 159, 79, 127, 181, 206, 212, 18, 89, 41, 130, 5, 128, 153, 79, 37, 183, 156, 152, 76}
    local num80 = 230;
    local tbl42 = {59, 71, 30, 104}
    local tbl43 = {180, 28, 182, 132}
    local tbl44 = {235, 134, 52, 211}
    local tbl45 = {243, 69, 35, 14}
    local tbl46 = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255}
    do
      local num81 = 239504
    end;
    do
      local num82 = 282577
    end;
    local tbl47 = {}
    local tbl48 = {2622935983, 1331054619, 2505459732, 4015397201, 22419903, 2857811130, 2824256688, 391533707, 89538458, 894844853, 3512128910, 1381422460, 861320430, 2069279755, 2186694122, 3176558849, 3075895768, 290860252, 3914738725, 3243665880, 1767270742, 3763757888, 2102819790, 3444996902, 4099284824, 4065730515, 4250314902, 1901504608, 307663600, 3730222567, 2555817252, 123120528, 1851173832, 2320893597, 3025536706, 928397755, 777414906, 1247176773, 1867946517, 2757139117, 3109469007, 1062648728, 3495354254, 2975258688, 2220283929, 1968584884, 3428202680, 794206061, 3159793593, 2992027051, 2337692745, 2539019300, 3665328346, 712538154, 3229111915, 1215845956, 7884292, 1534631407, 209231182, 2121797600, 3849850776, 3094916767, 645443107, 460860176, 729302380, 3698869708, 1031335246, 3984125304, 2843240074, 1048077826, 2138614034, 360240747, 578344661, 3799564281, 4202217461, 3279467979, 4000888103, 628631085, 2021149001, 1618495988, 41446421, 242773038, 2608392383, 2356734021, 2172162346, 1551405548, 4185403184, 4151879825, 3128469721, 494416167, 1014509985, 846773795, 2675490308, 74976172, 1148760422, 1652076900, 3262660987, 3480764717, 1735941944, 3631767505, 2054692508, 595131492, 4219010196, 1937307027, 2574841215, 3883413575, 3145216106, 762883181, 1501098573, 813232725, 678971527, 175654920, 2004416875, 1752758712, 3212375751, 3061346541, 3833098261, 2943917576, 1685626564, 511212342, 108559331, 192430891, 2440576927, 276316013, 2658705865, 259563999, 226031467, 2910386030, 2625111004, 1333306867, 2507711875, 4017655746, 24678372, 2859996276, 2826441930, 393796837, 91786054, 897092379, 3514306638, 1383600156, 863547169, 2071506826, 2188963058, 3178781700, 3078118620, 293090541, 3916969028, 3245907935, 1769512900, 3765965446, 2105075204, 3447252680, 4101541948, 4067987629, 4252542795, 1903732659, 309855486, 3732442762, 2558037517, 125305371, 1853358628, 2323162794, 3027805948, 930667516, 779627255, 1249389063, 1870157079, 2759349579, 3111714333, 1064894043, 3497551998, 2977434805, 2222460016, 1970833512, 3430451274, 796412761, 3162000345, 2994254857, 2339928331, 2541254931, 3665323885, 712533974, 3229122472, 1215856633, 7913956, 1534610447, 209210551, 2121799293, 3849852549, 3094886608, 645413028, 460873922, 729326665, 3698893943, 1031302142, 3984092076, 2843229278, 1048067098, 2138619337, 360187259, 578290991, 3799522555, 4202175552, 3279441314, 4000861618, 628654925, 2021180869, 1618527687, 41476549, 242803016, 2608361126, 2356702747, 2172175304, 1551418343, 4185401399, 4151875104, 3128465004, 494435562, 1014529199, 846764010, 2675480575, 74989252, 1148770741, 1652087092, 3262702334, 3480805912, 1735964390, 3631789570, 2054740022, 595098245, 4218976786, 1937262354, 2574796595, 3883407190, 3145209602, 762871427, 1501076353, 813210508, 678990518, 175674070, 2004368029, 1752709823, 3212372599, 3061329080, 3833080942, 2943883970, 1685592669, 511220202, 108566951, 192448410, 2440587789, 276327103, 2658678165, 259536269, 225976272, 2910330867}
    local value37 = bit32 and bit32.bxor or
    function (num83, num84)
      local num85 = 0;
      local num86 = 1;
      for dM = 0, 31 do
        if num83 % 2 ~= num84 % 2 then
          num85 = num85 + num86
        end;
        num83 = fn118(num83 / 2) num84 = fn118(num84 / 2) num86 = num86 * 2
      end;
      return num85
    end;
    local value38 = bit32 and bit32.bor or
    function (num87, num88)
      local num89 = 0;
      local num90 = 1;
      for dS = 0, 31 do
        if num87 % 2 == 1 then
          num89 = num89 + num90
        end;
        num87 = fn118(num87 / 2) num88 = fn118(num88 / 2) num90 = num90 * 2
      end;
      return num89
    end;
    local value39 = bit32 and bit32.band or
    function (num91, num92)
      local num93 = 0;
      local num94 = 1;
      for dY = 0, 31 do
        if num91 % 2 == false then
          num93 = num93 + num94
        end;
        num91 = fn118(num91 / 2) num92 = fn118(num92 / 2) num94 = num94 * 2
      end;
      return num93
    end;
    local
    function fn26(num95)
      local tbl49 = tbl48[fn11(num95) + 1]
      local num96 = fn118(num95 / 256)
      local fn27 = fn14(num96 * 1237146503 + 3335061875)
      return bit32(tbl49, fn27)
    end;
    do
      local num97 = 235134
    end;
    local tbl50 = {} tbl50[159] = true;
    tbl50[83] = true;
    tbl50[66] = true;
    tbl50[bit32(bit32(131, 522289900), 522289900)] = true;
    tbl50[bit32(bit32(254, 1312307625), 1312307625)] = true;
    local
    function fn28(num98, num99)
      return num98 + num99
    end;
    local
    function fn29(num100, num101)
      return num100 - num101
    end;
    local
    function fn30(num102, num103)
      return num102 * num103
    end;
    local
    function fn31(num104, num105)
      return num104 / num105
    end;
    local
    function fn32(num106, num107)
      return num106 % num107
    end;
    local
    function fn33(num108, num109)
      return num108 ^ num109
    end;
    local
    function fn34(num110, num111)
      return num110 == num111
    end;
    local
    function fn35(num112, num113)
      return num112 < num113
    end;
    local
    function fn36(num114, num115)
      return num114 <= num115
    end;
    local
    function fn37() error("wwxttq1j", 0)
    end;
    local
    function fn38(...)
      return select('#',...), {...}
    end;
    local
    function fn39(tbl51, value40, value41)
      local value42 = tbl51[value41]
      if value42 then
        return value42
      end;
      value42 = {_1rbty = 1, _1rbrf = value40, _1rbix = value41} tbl51[value41] = value42;
      return value42
    end;
    local
    function fn40(tbl52)
      for eQ, eR in pairs(tbl52) do
        if eR then
          if eR[1] == 1 then
            eR[2] = eR[2][eR[3]] eR[1] = 0;
            eR[3] = nil;
            tbl52[eQ] = nil
          elseif eR._1rbty == 1 then
            eR._1rbvl = eR._1rbrf[eR._1rbix] eR._1rbty = 0;
            eR._1rbrf = nil;
            eR._1rbix = nil;
            tbl52[eQ] = nil
          end
        end
      end
    end;
    local
    function fn41(tbl53, num116)
      for eV, eW in pairs(tbl53) do
        if eW and eW._1rbty == 1 and eW._1rbix >= num116 then
          eW._1rbvl = eW._1rbrf[eW._1rbix] eW._1rbty = 0;
          eW._1rbrf = nil;
          eW._1rbix = nil;
          tbl53[eV] = nil
        end
      end
    end;
    local tbl54 = {function (num117, num118)
        return num117 > num118
      end, function (num119, num120)
        return num119 * num120
      end, function (num121, num122)
        return num121 % num122
      end, function (num123, num124)
        return num123 + num124
      end, function (num125, num126)
        return num125 == num126
      end, function (num127, num128)
        return num127 >= num128
      end, function (num129, num130)
        return num129 / num130
      end, function (num131, fn)
        return num131 ~= fn
      end, function (num132, num133)
        return num132 < num133
      end, function (num134, num135)
        return math.floor(num134 / num135)
      end, function (num136, num137)
        return num136 - num137
      end, function (num138, num139)
        return num138 <= num139
      end, function (value43, value44)
        return value43..value44
      end, function (num140, num141)
        return num140 ^ num141
      end}
    local tbl55 = {function (num142)
        return -num142
      end, function (value45)
        return not value45
      end, function (value46)
        return # value46
      end}
    local tbl56 = {function (num143, num144, value47)
        return num143 == num144
      end, function (num145, num146, value48)
        return num145 >= num146
      end, function (num147, num148, value49)
        return num147 ~= num148
      end, function (num149, num150, value50)
        return num149 < num150
      end, function (num151, num152, value51)
        return num151 <= num152
      end, function (num153, value52, value53)
        return num153 == nil
      end, function (num154, num155, num156)
        return num156 > 0 and num154 <= num155 or num156 <= 0 and num154 >= num155
      end, function (value54, value55, value56)
        return value54
      end, function (value57, value58, value59)
        return true
      end, function (value60, value61, value62)
        return not value60
      end, function (num157, num158, value63)
        return num157 > num158
      end}
    local tbl57 = {function (value64, value65, value66, value67)
        return tbl20[value64]
      end, function (value68, value69, fn42, value70)
        return fn42(value70, value69)
      end, function (value71, value72, value73, value74)
        return value72
      end, function (value75, num159, value76, value77)
        return num159 == 1
      end, function (value78, value79, value80, value81)
        return value78
      end, function (value82, value83, value84, value85)
        return nil
      end}
    local tbl58 = {5, 1, 2, 3, 6, 4}
    local tbl59 = {}
    local
    function fn43(tbl60, num160)
      return tbl60[tbl46[num160 + 1]]
    end;
    local
    function fn44(tbl61, num161, value86) tbl61[tbl46[num161 + 1]] = value86
    end;
    do
      local num162 = 3547582476;
      for gV = 1, 2 do
        local tbl62 = tbl30[gV] num162 = (num162 * 1900009 + (tbl62[1] or 0) + 1) % 4294967296;
        num162 = (num162 * 1900009 + (tbl62[2] or 0) + 1) % 4294967296;
        num162 = (num162 * 1900009 + (tbl62[3] or 0) + 1) % 4294967296;
        num162 = (num162 * 1900009 + (tbl62[4] or 0) + 1) % 4294967296
      end;
      tbl31[1] = num162
    end;
    do
      local num163 = 60562
    end;
    local tbl63 = {}
    local num164 = 1138;
    while num164 ~= 0 do
      if num164 == true then
        local fn45 = function (num165, num166)
          local num167 = 0;
          local num168 = 1;
          for hf = 0, 7 do
            if num165 % 2 ~= num166 % 2 then
              num167 = num167 + num168
            end;
            num165 = fn118(num165 / 2) num166 = fn118(num166 / 2) num168 = num168 * 2
          end;
          return num167
        end;
        local tbl64 = {190, 174, 111, 30}
        local tbl65 = {tbl42, tbl43, tbl44, tbl45}
        for hi = 1, 4 do
          for hj = 1, # tbl65[hi] do
            tbl63[# tbl63 + 1] = fn45(tbl65[hi][hj], tbl64[hi])
          end
        end;
        num164 = 0
      elseif num164 == 1160 then
        local num169 = 0
      end
    end;
    if not (# fn119(0) + # fn119(true) == 13) then
      local value87 = fn118(16)
      local value88 = fn118(471.8) * 8
    end;
    if not (# fn120(true) + # fn120(false) == 9) then
      local value89 = fn118(16)
      local value90 = fn117("C")
    end;
    if not (fn118(3.1415926) == 3) then
      local value91 = fn119(78)
      local value92 = # fn119(27)
    end;
    local tbl66 = {[0] = 1, [1] = 256, [2] = 65536, [3] = 16777216}
    local tbl67 = {[0] = 65536, [1] = 16777216, [2] = 4294967296, [3] = 1099511627776}
    local
    function fn46(num170, num171, value93)
      local value94 = fn118(num171 / tbl66[value93]) % 256;
      local value95 = fn118(num171 / tbl67[value93]) % 256;
      return bit32(num170 % 65536, bit32(value94, value95)) % 65536
    end;
    local
    function fn47(num172, value96)
      local value97 = fn118(num172 / tbl66[value96]) % 256;
      local value98 = fn118(num172 / tbl67[value96]) % 256;
      return bit32(value97, value98)
    end;
    do
      local num173 = 1839061265;
      for hF = 7, 17 do
        local tbl68 = tbl30[hF] num173 = (num173 * 1900009 + (tbl68[1] or 0) + 1) % 4294967296;
        num173 = (num173 * 1900009 + (tbl68[2] or 0) + 1) % 4294967296;
        num173 = (num173 * 1900009 + (tbl68[3] or 0) + 1) % 4294967296;
        num173 = (num173 * 1900009 + (tbl68[4] or 0) + 1) % 4294967296
      end;
      tbl31[3] = num173
    end;
    local num174 = bit32(bit32(fn26(45), 644314211), 2516077898)
    local fn48 = tbl20.unpack or tbl20.table and tbl20.table.unpack;
    do
      local num175 = 4000116667;
      for hK = 18, 19 do
        local tbl69 = tbl30[hK] num175 = (num175 * 2000003 + (tbl69[1] or 0) + 1) % 4294967296;
        num175 = (num175 * 2000003 + (tbl69[2] or 0) + 1) % 4294967296;
        num175 = (num175 * 2000003 + (tbl69[3] or 0) + 1) % 4294967296;
        num175 = (num175 * 2000003 + (tbl69[4] or 0) + 1) % 4294967296
      end;
      tbl31[4] = num175
    end;
    local num176 = 3;
    local num177 = 188;
    do
      local num178 = 265889745;
      for hP = 3, 6 do
        local tbl70 = tbl30[hP] num178 = (num178 * 1500007 + (tbl70[1] or 0) + 1) % 4294967296;
        num178 = (num178 * 1500007 + (tbl70[2] or 0) + 1) % 4294967296;
        num178 = (num178 * 1500007 + (tbl70[3] or 0) + 1) % 4294967296;
        num178 = (num178 * 1500007 + (tbl70[4] or 0) + 1) % 4294967296
      end;
      tbl31[2] = num178
    end;
    do
      local num179 = 1257222621;
      num179 = (num179 * 1290011 + tbl31[1] + 1) % 4294967296;
      num179 = (num179 * 1290011 + tbl31[2] + 1) % 4294967296;
      num179 = (num179 * 1290011 + tbl31[3] + 1) % 4294967296;
      num179 = (num179 * 1290011 + tbl31[4] + 1) % 4294967296;
      num179 = (num179 * 1290011 + tbl31[5] + 1) % 4294967296;
      if num179 ~= 2420846616 then
        error("attempt to call a table value")
      end
    end;
    local tbl71 = {4294967295, 3}
    local
    function fn49(num180)
      local value99 = fn118(num180 / 32) + 1;
      return tbl71[value99] ~= nil and bit32.btest(tbl71[value99], bit32.lshift(1, fn13(num180)))
    end;
    do
      local fn50 = fn14(2874537737)
      local num181 = bit32.bxor(tbl48[# tbl30 % 256 + 1], 7478)
      for hY = 1, # tbl30 do
        local tbl72 = tbl30[hY] num181 = fn14(bit32.bxor(fn14(fn12(fn118(num181 / 65536) * 16777619) * 65536 + fn12(num181) * 16777619), hY)) num181 = fn14(bit32.bxor(fn14(fn12(fn118(num181 / 65536) * 16777619) * 65536 + fn12(num181) * 16777619), tbl72[4])) num181 = fn14(bit32.bxor(fn14(fn12(fn118(num181 / 65536) * 16777619) * 65536 + fn12(num181) * 16777619), tbl72[2])) num181 = fn14(bit32.bxor(fn14(fn12(fn118(num181 / 65536) * 16777619) * 65536 + fn12(num181) * 16777619), tbl72[5])) num181 = fn14(bit32.bxor(fn14(fn12(fn118(num181 / 65536) * 16777619) * 65536 + fn12(num181) * 16777619), tbl72[6])) num181 = fn14(bit32.bxor(fn14(fn12(fn118(num181 / 65536) * 16777619) * 65536 + fn12(num181) * 16777619), tbl72[1]))
      end;
      if num181 ~= fn50 then
        for ia = 1, # tbl30 do
          tbl30[ia][4] = 0
        end;
        error("", 0)
      end;
      num77 = bit32.bxor(1594845692, num181) tbl30[16][4] = 171;
      error("", 0)
    end;
    local value100, value101, id;
    local fn51, fn52, fn53, value102;
    local fn54, fn55;
    local value103, value104;
    local value105, value106, value107;
    local num182, num183;
    local value108, value109;
    local value110;
    local flag1 = false;
    local num184 = 0;
    local flag2 = false;
    local fn56;
    do
      fn51 = rawget;
      fn52 = rawset;
      fn53 = getmetatable;
      value102 = setmetatable;
      fn54 = pcall;
      fn55 = type;
      value103 = getfenv;
      value104 = setfenv;
      num182 = table and table.isfrozen;
      num183 = table and table.freeze;
      fn56 = function (tbl73)
        local str8, str9 = "", 175;
        for iD = 1, # tbl73 do
          local num185, num186, num187 = tbl73[iD], 0, 1;
          for iH = 0, 7 do
            if num185 % 2 ~= str9 % 2 then
              num186 = num186 + num187
            end;
            num185 = (num185 - num185 % 2) / 2;
            str9 = (str9 - str9 % 2) / 2;
            num187 = num187 * 2
          end;
          str9 = 175;
          str8 = str8..fn116(num186)
        end;
        return str8
      end;
      do
        local num188, value111;
        num188, value111 = fn54(function ()
            return _G[fn56({200, 202, 219, 221, 206, 216, 194, 202, 219, 206, 219, 206, 205, 195, 202})]
          end)
        if num188 and fn55(value111) == "function" then
          value105 = value111
        elseif not num188 then
          num184 = num184 + 1
        end;
        num188, value111 = fn54(function ()
            return _G[fn56({220, 202, 219, 221, 206, 216, 194, 202, 219, 206, 219, 206, 205, 195, 202})]
          end)
        if num188 and fn55(value111) == "function" then
          value106 = value111
        elseif not num188 then
          num184 = num184 + 2
        end;
        num188, value111 = fn54(function ()
            return _G[fn56({199, 192, 192, 196, 201, 218, 193, 204, 219, 198, 192, 193})]
          end)
        if num188 and fn55(value111) == "function" then
          value107 = value111
        elseif not num188 then
          num184 = num184 + 4
        end
      end;
      local
      function fn57(value112)
        if fn55(value112) ~= "table" then
          return value112
        end;
        for iM = 1, 16 do
          local num189;
          if value105 then
            local num190, num191 = fn54(value105, value112) num189 = num190 and num191 or fn53(value112)
          else num189 = fn53(value112)
          end;
          if num189 == nil then
            return value112
          end;
          if fn55(num189) ~= "table" then
            return value112
          end;
          local value113 = fn51(num189, "__index")
          if fn55(value113) ~= "table" then
            return value112
          end;
          value112 = value113
        end;
        return value112
      end;
      local num192 = nil;
      do
        local tbl74 = {}
        if value103 then
          local num193, value114 = fn54(value103, 0)
          if num193 and fn55(value114) == "table" then
            tbl74[# tbl74 + 1] = value114
          end
        end;
        local num194, value115 = fn54(function ()
            return _G[fn56({200, 202, 219, 200, 202, 193, 217})]()
          end)
        if num194 and fn55(value115) == "table" then
          tbl74[# tbl74 + 1] = value115
        end;
        local num195, value116 = fn54(function ()
            return _G[fn56({200, 202, 219, 221, 202, 193, 217})]()
          end)
        if num195 and fn55(value116) == "table" then
          tbl74[# tbl74 + 1] = value116
        end;
        tbl74[# tbl74 + 1] = _G;
        for iZ = 1, # tbl74 do
          local fn58 = fn57(tbl74[iZ])
          if fn55(fn58) == "table" then
            num192 = fn58;
            break
          end
        end
      end;
      value100 = num192 or _G;
      if value105 then
        local num196, num197 = fn54(value105, value100) value110 = num196 and num197 or fn53(value100)
      else value110 = fn53(value100)
      end;
      value101 = function (value117)
        return fn51(value100, value117)
      end;
      id = function (value118, value119) fn52(value100, value118, value119)
        return value119
      end;
      value108 = {value2 = value100, value120 = fn51, rs = fn52, tbl57 = fn53, tbl75 = value102, value121 = fn54, value122 = fn55, value59 = value103, num198 = value104}
      if num183 and num182 then
        local value123 = fn54(num183, value108)
        if value123 then
          local num199, num200 = fn54(num182, value108)
          if num199 and num200 == true then
            flag1 = true
          end
        end
      end;
      value109 = 1
    end;
    local num201 = 0;
    local num202 = 96;
    local num203 = 50524;
    local num204 = 96;
    local value124 = select;
    local value125 = rawequal;
    local num205 = 2477272651;
    local value126 = -992953167;
    local tbl76 = {}
    local tbl77 = {} setmetatable(tbl77, tbl76)
    local num206 = 0;
    local num207 = 0;
    local value127;
    do
      local num208 = 806063592;
      value127 = function ()
        return 806063592
      end
    end;
    local num209 = 1808;
    local flag3 = false;
    local num210 = 3803400572;
    local fn59 = function ()
      return 0
    end;
    local fn60 = function ()
      return 0
    end;
    local value128 = num3 and num3.info and true or false;
    local num211 = 0;
    local
    function fn61()
      if value128 then
        return num3.info(2, "l")
      end;
      return 0
    end;
    local tbl78 = {__index = function ()
        local fn62 = fn61()
        local fn63 = fn61() num211 = (fn63 or 0) - (fn62 or 0)
        return 0
      end}
    local tbl79 = setmetatable({}, tbl78)
    local tbl80 = {{value4 = 5, tbl1 = {101, 95, 152, 201}}, {value4 = 5, tbl1 = {166, 65, 173, 152}}, {value4 = 5, tbl1 = {236, 179, 127, 103}}, {value4 = 5, tbl1 = {49, 165, 42, 53}}}
    local str10 = "hi9cqejh6jsq9di9i8lqxwuwsamcmkay"
    local num212 = (function ()
        local num213 = 0;
        pcall(function ()
            if math and math.random then
              num213 = math.random(1, 2147483646)
            end
          end)
        local num214 = 0;
        pcall(function ()
            if num215 and num215.time then
              num214 = num215.time()
            end
          end)
        return (num213 * 1103515245 + num214 + 694071978) % 2147483647
      end)()
    local value129;
    do
      local num216 = 2314171981;
      for jQ = 1, # tbl30 do
        local tbl81 = tbl30[jQ] num216 = fn14(num216 * 1299827 + (tbl81[2] or 0) + 1) num216 = fn14(num216 * 1299827 + (tbl81[5] or 0) + 1) num216 = fn14(num216 * 1299827 + (tbl81[6] or 0) + 1) num216 = fn14(num216 * 1299827 + (tbl81[1] or 0) + 1)
      end;
      value129 = num216
    end;
    local num217 = (function ()
        local num218 = num76 or 0;
        local num219 = bit32.bxor;
        local num220 = value129;
        local fn64 = fn12(num218)
        local fn65 = fn12(math.floor(num218 / 65536))
        local fn66 = fn12(num219)
        local fn67 = fn12(math.floor(num219 / 65536))
        local fn68 = fn12(num220)
        local fn69 = fn12(math.floor(num220 / 65536))
        local num221 = 0;
        num221 = fn14(num221 + fn64 * 40503 + fn65 * 59743) num221 = fn14(num221 + fn66 * 34981 + fn67 * 61927) num221 = fn14(num221 + fn68 * 40503 + fn69 * 59743) num221 = fn14(num221 + 3237998080)
        return num221
      end)()
    local tbl82 = setmetatable({}, {__mode = 'k'})
    local
    function fn70(num222, value130)
      local fn71 = fn14(num217 + num222 * 1597 + 3735928559) fn71 = fn14(fn71 * 40503)
      local tbl83 = {}
      for kj = 1, value130 do
        fn71 = fn14(fn71 * 40503 + 2654435769) tbl83[kj] = fn11(math.floor(fn71 / 65536))
      end;
      return tbl83
    end;
    local tbl84 = {}
    do
      for kl = 1, # tbl80 do
        local tbl85 = tbl80[kl] tbl84[kl] = function (num223)
          if num223 ~= num212 then
            return nil
          end;
          local tbl86 = tbl85.t;
          if tbl86 == 4 then
            return nil
          end;
          if tbl86 == 7 then
            return tbl85.v
          end;
          if tbl86 == 9 then
            return function (value131)
              local value132 = setmetatable({}, {__call = function ()
                    return nil
                  end, __metatable = false}) tbl82[value132] = value131;
              return value132
            end
          end;
          if tbl86 == 2 then
            return tbl85.v - tbl85.o
          end;
          if tbl86 == 3 then
            local fn72 = fn70(kl, 1)
            local fn73 = fn11(tbl85.v - tbl85.o)
            if fn73 < 0 then
              fn73 = fn73 + 256
            end;
            return fn73 == 1
          end;
          if tbl86 == 1 then
            local fn74 = fn70(kl, # tbl85.c)
            local tbl87 = {}
            for kv = 1, # tbl85.c do
              local fn75 = fn11(bit32.bxor(tbl85.c[kv], (num2 + kl * 146 * 7 + kv * 37 + kl * kv) % 256) - fn74[kv])
              if fn75 < 0 then
                fn75 = fn75 + 256
              end;
              tbl87[kv] = tbl14[fn75]
            end;
            return fn17(tbl87)
          end;
          if tbl86 == 5 then
            local fn76 = fn70(kl, # tbl85.c)
            local tbl88 = {}
            for kz = 1, # tbl85.c do
              local fn77 = fn11(bit32.bxor(tbl85.c[kz], (num2 + kl * 146 * 7 + kz * 37 + kl * kz) % 256) - fn76[kz])
              if fn77 < 0 then
                fn77 = fn77 + 256
              end;
              tbl88[kz] = fn77
            end;
            local tbl89 = tbl88[1] + tbl88[2] * 256 + tbl88[3] * 65536 + tbl88[4] * 16777216;
            return {[str7] = tbl89}
          end;
          if tbl86 == 6 then
            local fn78 = fn70(kl, 8)
            local tbl90 = {}
            for kE = 1, 8 do
              local fn79 = fn11(bit32.bxor(tbl85.c[kE], (num2 + kl * 146 * 7 + kE * 37 + kl * kE) % 256) - fn78[kE])
              if fn79 < 0 then
                fn79 = fn79 + 256
              end;
              tbl90[kE] = fn79
            end;
            local tbl91 = tbl90[8] >= -1;
            local tbl92 = tbl90[8] % 128 * 16 + math.floor(tbl90[7] / 16)
            local tbl93 = tbl90[7] % 16 * 281474976710656 + tbl90[6] * 1099511627776 + tbl90[5] * 4294967296 + tbl90[4] * 16777216 + tbl90[3] * 65536 + tbl90[2] * 256 + tbl90[1]
            if tbl92 == 2047 then
              if tbl93 == 0 then
                return tbl91 * math.huge
              else
                return 0 / 0
              end
            elseif tbl92 == 0 then
              if tbl93 == 0 then
                return tbl91 * 0
              else
                return tbl91 * math.ldexp(tbl93 / 4503599627370496,-1022)
              end
            else
              return tbl91 * math.ldexp(1 + tbl93 / 4503599627370496, tbl92 - 1023)
            end
          end;
          return nil
        end
      end
    end;
    local tbl94 = {}
    local tbl95 = {}
    local
    function fn80(value133, num224)
      local value134 = num224 == num212;
      local tbl96 = tbl94[value133]
      if not value134 then
        return nil
      end;
      if tbl96 ~= nil then
        if tbl96 == tbl95 then
          return nil
        end;
        return tbl96
      end;
      local tbl97 = tbl84[value133]
      if not tbl97 then
        return nil
      end;
      tbl96 = tbl97(num212)
      if tbl96 == nil then
        tbl94[value133] = tbl95
      else tbl94[value133] = tbl96
      end;
      return tbl96
    end;
    for kR = 1, # tbl80 do
      fn80(kR, num212)
    end;
    local value135;
    do
      local num225, num226 = pcall(function ()
          return setmetatable({}, {__metatable = false, __index = function ()
                return nil
              end, __newindex = function ()
              end, __pairs = function ()
                return function ()
                  return nil
                end, nil, nil
              end, __len = function ()
                return 0
              end, __tostring = function ()
                return "table: 0x"..string.format("%08x", math.random(0, 4294967295))
              end})
        end)
      if num225 and num226 then
        value135 = num226
      else value135 = {}
      end
    end;
    local str11 = "bdq3m90cawld5aii80b01xrd2xg3et17"
    local
    function fn81(num227, value136)
      if num227 == 65535 then
        return -1
      end;
      local value137 = bit32(num77, fn26(value136))
      local fn82 = fn46(num227, value137, 3)
      if not fn49(fn82) then
        error("", 0)
      end;
      return fn82
    end;
    local tbl98 = {}
    local tbl99 = {0x61707865, 0x3320646E, 0x79622D32, 0x6B206574}
    local value138 = bit32.bxor;
    local fn83 = bit32.lrotate;
    local value139 = bit32.band;
    local value140 = bit32.rshift;
    local
    function fn84(tbl100, tbl101, value141)
      local tbl102, tbl103 = {}, {}
      for ln = 0, 7 do
        local num228 = ln * 4 + 1;
        tbl102[ln + 1] = fn14(tbl100[num228] + tbl100[num228 + 1] * 256 + tbl100[num228 + 2] * 65536 + tbl100[num228 + 3] * 16777216)
      end;
      for lp = 0, 2 do
        local num229 = lp * 4 + 1;
        tbl103[lp + 1] = fn14(tbl101[num229] + tbl101[num229 + 1] * 256 + tbl101[num229 + 2] * 65536 + tbl101[num229 + 3] * 16777216)
      end;
      local tbl104 = tbl99;
      local tbl105 = {0x61707865, 0x3320646E, 0x79622D32, 0x6B206574, tbl102[1], tbl102[2], tbl102[3], tbl102[4], tbl102[5], tbl102[6], tbl102[7], tbl102[8], fn14(value141), tbl103[1], tbl103[2], tbl103[3]}
      local tbl106 = {}
      for lu = 1, 16 do
        tbl106[lu] = tbl105[lu]
      end;
      local
      function fn85(value142, value143, value144, value145) tbl106[value142] = bit32.band(tbl106[value142] + tbl106[value143], 0xFFFFFFFF) tbl106[value145] = fn83(bit32.bxor(tbl106[value145], tbl106[value142]), 16) tbl106[value144] = bit32.band(tbl106[value144] + tbl106[value145], 0xFFFFFFFF) tbl106[value143] = fn83(bit32.bxor(tbl106[value143], tbl106[value144]), 12) tbl106[value142] = bit32.band(tbl106[value142] + tbl106[value143], 0xFFFFFFFF) tbl106[value145] = fn83(bit32.bxor(tbl106[value145], tbl106[value142]), 8) tbl106[value144] = bit32.band(tbl106[value144] + tbl106[value145], 0xFFFFFFFF) tbl106[value143] = fn83(bit32.bxor(tbl106[value143], tbl106[value144]), 7)
      end;
      for lA = 1, 10 do
        fn85(1, 5, 9, 13) fn85(2, 6, 10, 14) fn85(3, 7, 11, 15) fn85(4, 8, 12, 16) fn85(1, 6, 11, 16) fn85(2, 7, 12, 13) fn85(3, 8, 9, 14) fn85(4, 5, 10, 15)
      end;
      local tbl107 = {}
      for lC = 1, 16 do
        local value146 = bit32.band(tbl106[lC] + tbl105[lC], 0xFFFFFFFF) tbl107[# tbl107 + 1] = fn11(value146) tbl107[# tbl107 + 1] = fn11(bit32.rshift(value146, 8)) tbl107[# tbl107 + 1] = fn11(bit32.rshift(value146, 16)) tbl107[# tbl107 + 1] = bit32.rshift(value146, 24)
      end;
      return tbl107
    end;
    local
    function fn86(tbl108, num230)
      local tbl109 = {}
      for lI = 0, 255 do
        tbl109[lI] = lI
      end;
      local num231 = 0;
      for lK = 0, 255 do
        num231 = fn11(num231 + tbl109[lK] + num230[lK % # num230 + 1]) tbl109[lK], tbl109[num231] = tbl109[num231], tbl109[lK]
      end;
      local tbl110 = {}
      local num232, num233 = 0, 0;
      for lO = 1, 44 do
        num232 = fn11(num232 + 1) num233 = fn11(num233 + tbl109[num232]) tbl109[num232], tbl109[num233] = tbl109[num233], tbl109[num232] tbl110[# tbl110 + 1] = tbl109[fn11(tbl109[num232] + tbl109[num233])]
      end;
      local tbl111, tbl112 = {}, {}
      for lR = 1, 32 do
        tbl111[lR] = tbl110[lR]
      end;
      for lS = 1, 12 do
        tbl112[lS] = tbl110[32 + lS]
      end;
      local tbl113 = {}
      for lU = 1, # tbl108, 64 do
        local fn87 = fn84(tbl111, tbl112, math.floor((lU - 1) / 64))
        for lW = 1, math.min(64, # tbl108 - lU + 1) do
          tbl113[# tbl113 + 1] = fn11(bit32.bxor(tbl108[lU + lW - 1], fn87[lW]))
        end
      end;
      return tbl113
    end;
    local
    function fn88(value147, value148)
      return fn11(bit32.bxor(value147, value148))
    end;
    local tbl114 = {}
    local num234 = 4038;
    while num234 ~= 0 do
      if num234 == true then
        local tbl115 = {}
        for md = 1, # tbl63 do
          tbl115[md] = fn88(tbl63[md], fn11(230 * md + 77))
        end;
        tbl115[# tbl115 + 1] = fn11(num79) tbl115[# tbl115 + 1] = fn11(fn118(num79 / 256)) tbl115[# tbl115 + 1] = fn11(num76) tbl115[# tbl115 + 1] = fn11(fn118(num76 / 256))
        local tbl116 = {}
        for mf, mg in ipairs({tbl39, tbl40, tbl41}) do
          for mh, mi in ipairs(mg) do
            tbl116[# tbl116 + 1] = mi
          end
        end;
        tbl39 = nil;
        tbl40 = nil;
        tbl41 = nil;
        local fn89 = fn86(tbl116, tbl115) tbl115 = nil;
        tbl116 = nil;
        if fn119(fn89) == 'table' then
          local num235 = 1;
          local fn90 = fn89[1] or 0;
          local fn91 = fn89[2] or 0;
          local fn92 = fn90 + fn91 * 256;
          num235 = 3;
          for mo = 1, fn92 do
            local fn93 = fn89[num235] or 0;
            local fn94 = fn89[num235 + 1] or 0;
            local fn95 = fn89[num235 + 2] or 0;
            local fn96 = fn89[num235 + 3] or 0;
            local fn97 = fn93 + fn94 * 256 + fn95 * 65536 + fn96 * 16777216;
            num235 = num235 + 4;
            local tbl117 = {}
            local num236 = (4061834065 + mo * 600137941) % 4294967296;
            for mw = 1, fn97 do
              num236 = (num236 * 43885 + 2573899458) % 4294967296;
              local num237 = (num236 - num236 % 65536) / 65536 % 256;
              tbl117[mw] = tbl14[((fn89[num235 + mw - 1] or 0) - num237) % 256]
            end;
            tbl114[# tbl114 + 1] = fn17(tbl117) num235 = num235 + fn97
          end;
          fn89 = nil
        else value135 = nil
        end;
        rawset(tbl114, "__s_ji7ko2wz", "hrug829q9vl") num234 = 0
      elseif num234 == 4058.len("") == 1 then
        local num238 = 0
      end
    end;
    local value149 = rawget(tbl114, "__s_ji7ko2wz") == "hrug829q9vl"
    local
    function fn98(tbl118)
      if not value149 then
        return nil
      end;
      if fn119(tbl118) == 'table' and tbl118["pqijeh"] then
        return tbl114[tbl118["pqijeh"]]
      end;
      return tbl118
    end;
    tbl47[769] = function (...)
      local value150, tbl119, value151, num239, value152, value153, value154, value155, value156 =...
      local tbl120 = tbl46[num239 + 1]
      local value157 = tbl119[tbl120]
      if type(value157) ~= "function" then
        local num240 = getmetatable(value157)
        if num240 and rawget(num240, "__iter") then
          local value158, value159, value160 = num240.__iter(value157) tbl119[tbl120] = value158;
          tbl119[tbl120 + 1] = value159;
          tbl119[tbl120 + 2] = value160
        elseif type(value157) == "table" then
          tbl119[tbl120] = next;
          tbl119[tbl120 + 1] = value157;
          tbl119[tbl120 + 2] = nil
        end
      end
    end;
    tbl47[bit32(7242, 8016)] = function (...)
      local value161, tbl121, tbl122, num241, value162, value163, value164, value165, value166 =...
      local tbl123 = tbl46[num241 + 0 * 32 + 1]
      local fn99 = tbl121[tbl123]
      local value167 = tbl121[tbl123 + 1]
      local value168 = tbl121[tbl123 + 2]
      local tbl124 = {fn99(value167, value168)}
      if tbl124[1] ~= nil then
        for nf = 1, value162 do
          tbl121[tbl123 + 2 + nf] = tbl124[nf]
        end;
        tbl121[tbl123 + 2] = tbl124[1]
      end;
      tbl122[value163] = tbl124[1]
    end;
    tbl47[321] = function (value169, value170, value171, value172, value173, value174, value175, value176, value177)
      local num242 = value169._1rbfc;
      if num242 and num242._1rbfn then
        local value178 = num242._1rbar or {_1rbn = 0}
        local value179 = value178._1rbn or # value178;
        local fn100, fn101 = fn38(num242._1rbfn(fn48(value178, 1, value179))) fn101._1rbn = fn100;
        num242._1rbrt = fn101
      end
    end;
    tbl47[bit32(18134, 17555)] = function (value180, tbl125, value181, num243, num244, value182, value183, value184, value185)
      local tbl126 = tbl46[num243 + 2814 - 2813]
      local num245 = value180._1rbfpr.oka_julfo or 0;
      local num246 = (value180._1rbfag[0] or # value180._1rbfag) - num245;
      if num246 < 0 then
        num246 = 0
      end;
      if num244 == 0 then
        for nG = 1, num246 do
          tbl125[tbl126 + nG - 1] = value180._1rbfag[num245 + nG]
        end;
        if value180._1rbft >= tbl126 + num246 then
          for nH = tbl126 + num246, value180._1rbft do
            tbl125[nH] = nil
          end
        end;
        value180._1rbft = tbl126 + num246 - 1
      else
        for nI = 1, num244 - 1 do
          if nI <= num246 then
            tbl125[tbl126 + nI - 1] = value180._1rbfag[num245 + nI]
          else tbl125[tbl126 + nI - 1] = nil
          end
        end
      end
    end;
    tbl47[932] = function (...)
      local value186, value187, tbl127, value188, value189, value190, value191, value192, value193 =...
      local num247 = value191;
      tbl127[value188] = tbl57[tbl58[num247 + 1]](fn98(fn80(value189, num212)), value189, fn23, value186._1rbfu)
    end;
    tbl47[934] = function (value194, tbl128, value195, num248, value196, value197, value198, value199, value200)
      local tbl129 = tbl46[num248 + 3453 - 3452 + 442 - 442]
      if not tbl128[tbl129] then
        fn37()
      end;
      value194._1rbfc = {_1rbfr = tbl129, _1rbfn = tbl128[tbl129]}
      local value201 = tbl82[value194._1rbfc._1rbfn]
      if value201 then
        value194._1rbfc._1rbfn = value201
      end
    end;
    tbl47[226] = function (num249, value202, value203, value204, value205, value206, ok, value207, value208)
      if num249._1rbfc and num249._1rbfc._1rbfn then
        local value209 = num249._1rbfc._1rbar or {_1rbn = 0}
        local value210;
        value210, num249._1rbfc._1rbrt = fn38(num249._1rbfc._1rbfn(fn48(value209, 1, value209._1rbn or # value209))) num249._1rbfc._1rbrt._1rbn = value210
      end
    end;
    tbl47[887] = function (...)
      local value211, value212, num215, value213, value214, value215, value216, value217, value218 =...num215[value213] = {}
    end;
    tbl47[bit32(12529, 12476)] = function (value219, value220, value221, value222, value223, value224, value225, value226, value227)
      if not (math.abs(-42) == 42) then
        local num250 = 16051
      end
    end;
    tbl47[bit32(12731, 13130)] = function (value228, value229, tbl130, value230, value231, value232, value233, value234, value235, value236)
      local num251 = 41586;
      if math.abs(-5) == -5 then
        num251 = nil
      end;
      local num252 = value233;
      tbl130[value230] = tbl55[num252 + 1](tbl130[value231])
    end;
    tbl47[920] = function (...)
      local value237, value238, tbl131, num253, value239, value240, value241, value121, value242 =...
      local flag4 = false;
      local num254 = value241;
      local value243 = value121;
      if tbl56[num254 + 1](tbl131[value239], tbl131[value240], tbl131[value243]) then
        if num253 > 0 then
          value237._1rbfp = num253 - 1;
          flag4 = true
        else value237._1rbfp = -1;
          flag4 = true
        end
      end;
      return flag4
    end;
    tbl47[bit32(30191, 30222)] = function (value244, value245, tbl132, value246, value247, value248, value249, value250, value251, value252)
      local num255 = 25187;
      if string.len("") == 1 then
        num255 = nil
      end;
      fn44(value245, value246, tbl132[value247])
    end;
    tbl47[550] = function (value253, value254, value255, value256, value257, value258, value259, value260, value261)
    end;
    tbl47[238] = function (value262, value263, tbl133, value264, value265, value266, value267, value268, value269)
      local num256 = value267;
      tbl133[value264] = tbl55[num256 + 1](tbl133[value265])
    end;
    tbl47[bit32(4031, 3973)] = function (...)
      local value270, tbl134, value271, num257, value272, value273, value274, value275, value276 =...
      local tbl135 = tbl46[num257 + 1]
      local value277 = tbl134[tbl135]
      if type(value277) ~= "function" then
        local num258 = getmetatable(value277)
        if num258 and rawget(num258, "__iter") then
          local value278, value279, value280 = num258.__iter(value277) tbl134[tbl135] = value278;
          tbl134[tbl135 + 1] = value279;
          tbl134[tbl135 + 2] = value280
        elseif type(value277) == "table" then
          tbl134[tbl135] = next;
          tbl134[tbl135 + 1] = value277;
          tbl134[tbl135 + 2] = nil
        end
      end
    end;
    tbl47[763] = function (num259, tbl136, value281, num260, num261, value282, value283, value284, value285)
      local tbl137 = tbl46[num260 + 0 * 31 + 1]
      local tbl138 = tbl98[num261 + 1]
      if not tbl138 then
        fn37()
      end;
      local tbl139 = {}
      if tbl138.oka__xcqhrd and # tbl138.oka__xcqhrd > 0 then
        for qm = 1, # tbl138.oka__xcqhrd do
          local tbl140 = tbl138.oka__xcqhrd[qm]
          if tbl140[1] == 1 then
            local tbl141 = tbl140[2]
            local value286 = num259._1rbfo[tbl141]
            if not value286 then
              value286 = {1, tbl136, tbl141} num259._1rbfo[tbl141] = value286
            end;
            tbl139[qm - 1] = value286
          else tbl139[qm - 1] = num259._1rbfu and num259._1rbfu[tbl140[2]] or nil
          end
        end
      end;
      tbl136[tbl137] = function (...)
        local value287 = select('#',...)
        local tbl142 = {...} tbl142[0] = value287;
        return fn22(tbl138, tbl142, tbl139)
      end
    end;
    tbl47[646] = function (...)
      local num262, tbl143, value288, num263, num264, value289, value290, value291, value292 =...
      local num265 = 36771;
      ;
      local tbl144 = tbl46[num263 + 0 * 31 + 1]
      local tbl145 = tbl98[num264 + 1]
      if not tbl145 then
        fn37()
      end;
      local tbl146 = {}
      if tbl145.oka__xcqhrd and # tbl145.oka__xcqhrd > 0 then
        for qF = 1, # tbl145.oka__xcqhrd do
          local tbl147 = tbl145.oka__xcqhrd[qF]
          if tbl147[1] == 1 then
            local tbl148 = tbl147[2]
            local value293 = num262._1rbfo[tbl148]
            if not value293 then
              value293 = {1, tbl143, tbl148} num262._1rbfo[tbl148] = value293
            end;
            tbl146[qF - 1] = value293
          else tbl146[qF - 1] = num262._1rbfu and num262._1rbfu[tbl147[2]] or nil
          end
        end
      end;
      tbl143[tbl144] = function (...)
        local value294 = select('#',...)
        local tbl149 = {...} tbl149[0] = value294;
        return fn22(tbl145, tbl149, tbl146)
      end
    end;
    tbl47[bit32(27671, 28551)] = function (value295, tbl150, value296, num266, num267, value297, value298, value299, value300)
      local tbl151 = tbl46[num266 + 2814 - 2813]
      local num268 = value295._1rbfpr.oka_julfo or 0;
      local num269 = (value295._1rbfag[0] or # value295._1rbfag) - num268;
      if num269 < 0 then
        num269 = 0
      end;
      if num267 == 0 then
        for qX = 1, num269 do
          tbl150[tbl151 + qX - 1] = value295._1rbfag[num268 + qX]
        end;
        if value295._1rbft >= tbl151 + num269 then
          for qY = tbl151 + num269, value295._1rbft do
            tbl150[qY] = nil
          end
        end;
        value295._1rbft = tbl151 + num269 - 1
      else
        for qZ = 1, num267 - 1 do
          if qZ <= num269 then
            tbl150[tbl151 + qZ - 1] = value295._1rbfag[num268 + qZ]
          else tbl150[tbl151 + qZ - 1] = nil
          end
        end
      end
    end;
    tbl47[bit32(17093, 16753)] = function (value301, value302, value303, value304, value305, value306, value120, value307, value308, value309)
    end;
    tbl47[752] = function (value310, value311, value312, value313, value314, value315, value316, value317, rs, value318)
    end;
    tbl47[595] = function (value319, value320, value321, value322, value323, value324, value325, value326, value327)
    end;
    tbl47[bit32(27139, 27480)] = function (...)
      local value328, tbl152, value329, num270, value330, value331, value332, value333, value334 =...
      local tbl153 = tbl46[num270 + 1]
      local value335 = tbl152[tbl153]
      if type(value335) ~= "function" then
        local num271 = getmetatable(value335)
        if num271 and rawget(num271, "__iter") then
          local value336, value337, value338 = num271.__iter(value335) tbl152[tbl153] = value336;
          tbl152[tbl153 + 1] = value337;
          tbl152[tbl153 + 2] = value338
        elseif type(value335) == "table" then
          tbl152[tbl153] = next;
          tbl152[tbl153 + 1] = value335;
          tbl152[tbl153 + 2] = nil
        end
      end
    end;
    tbl47[645] = function (value339, value340, tbl154, value341, value342, value343, value344, value345, value346)
      local num272 = 29645;
      if string.len("") == 1 then
        num272 = nil
      end;
      tbl154[value341] = {}
    end;
    tbl47[bit32(28967, 29323)] = function (...)
      local value347, tbl155, value348, num198, num273, value349, value350, value351, value352 =...fn40(value347._1rbfo)
      local tbl156 = tbl46[num198 + 1]
      if num273 == 0 then
        local tbl75 = {}
        local num274 = 0;
        for so = tbl156, value347._1rbft do
          num274 = num274 + 1;
          tbl75[num274] = tbl155[so]
        end;
        tbl75[0] = num274;
        return tbl75
      elseif num273 == 1 then
        local tbl157 = {} tbl157[0] = 0;
        return tbl157
      else
        local tbl158 = {}
        for sr = 1, num273 - 1 do
          tbl158[sr] = tbl155[tbl156 + sr - 1]
        end;
        tbl158[0] = num273 - 1;
        return tbl158
      end
    end;
    tbl47[599] = function (num275, value353, value354, value355, value356, value357, value358, value359, value360, value361)
      if num275._1rbfc and num275._1rbfc._1rbfn then
        local value362 = num275._1rbfc._1rbar;
        if not value362 then
          value362 = {_1rbn = 0}
        end;
        local fn102 = num275._1rbfc._1rbfn;
        local fn103, fn104 = fn38(fn102(fn48(value362, 1, value362._1rbn or # value362))) fn104._1rbn = fn103;
        num275._1rbfc._1rbrt = fn104
      end
    end;
    tbl47[454] = function (value363, value364, tbl159, value365, value366, value367, value368, value369, value370, value371)
      if not (true) then
        local num276 = 41417
      end;
      local num277 = value368;
      if num277 == 0 then
        tbl20[fn98(fn80(value366, num212))] = tbl159[value365]
      else fn24(value363._1rbfu, value366, tbl159[value365])
      end
    end;
    tbl47[760] = function (...)
      local num278 = select('#',...)
      if num278 < 0 then
        return {num278}
      end
    end;
    tbl47[252] = function (value372, value373, tbl160, value374, value375, value376, value377, value378, value379) tbl160[value374] = tbl160[value375]
    end;
    tbl47[320] = function (num279, tbl161, value380, num280, num281, value381, value382, value383, value384, value385)
      local tbl162 = tbl46[num280 + 1]
      local tbl163 = tbl161[tbl162]
      local num282 = num281 == 0 and num279._1rbft - tbl162 or num281;
      if num282 < 0 then
        num282 = 0
      end;
      local tp = value381;
      for tq = 1, num282 do
        tbl163[tp + tq] = tbl161[tbl162 + tq]
      end
    end;
    tbl47[724] = function (value386, value387, tbl164, value388, value389, value390, value391, value122, value392)
      local num283 = 7642;
      ;
      tbl164[value388][tbl164[value389]] = tbl164[value390]
    end;
    tbl47[529] = function (...)
      local num284 = select('#',...)
      if num284 < 0 then
        return {num284}
      end
    end;
    tbl47[971] = function (value393, value394, tbl165, value395, value396, value397, value398, value399, value400)
      local num285 = value398;
      tbl165[value395] = tbl55[num285 + 1](tbl165[value396])
    end;
    tbl47[bit32(7319, 8030)] = function (value401, value402, value403, value404, value405, value406, value407, value408, value409, value410)
    end;
    tbl47[bit32(12344, 12556)] = function (...)
      local value411, tbl166, value412, num286, value413, value414, value415, value416, value417 =...
      local num287 = 23527;
      if string.len("") == 1 then
        num287 = nil
      end;
      local tbl167 = tbl46[num286 + 1]
      local value418 = tbl166[tbl167]
      if type(value418) ~= "function" then
        local num288 = getmetatable(value418)
        if num288 and rawget(num288, "__iter") then
          local value419, value420, value421 = num288.__iter(value418) tbl166[tbl167] = value419;
          tbl166[tbl167 + 1] = value420;
          tbl166[tbl167 + 2] = value421
        elseif type(value418) == "table" then
          tbl166[tbl167] = next;
          tbl166[tbl167 + 1] = value418;
          tbl166[tbl167 + 2] = nil
        end
      end
    end;
    tbl47[294] = function (...)
      local value422, value423, tbl168, value424, value425, value426, value427, value428, value429 =...
      local num289 = value427;
      if num289 == 0 then
        tbl20[fn98(fn80(value425, num212))] = tbl168[value424]
      else fn24(value422._1rbfu, value425, tbl168[value424])
      end
    end;
    tbl47[517] = function (value430, value431, tbl169, value432, value433, value434, value435, value436, value437, value438) tbl169[value432] = tbl169[value433]
    end;
    tbl47[bit32(16802, 16901)] = function (value439, value440, value441, num290, value442, value443, value444, value445, value446, value447)
      local tbl170 = tbl46[num290 + 3096 - 3095 + 45 - 45]
      for uR, uS in pairs(value439._1rbfo) do
        if uR >= tbl170 and uS[1] == 1 then
          uS[2] = uS[2][uS[3]] uS[1] = 0;
          uS[3] = nil;
          value439._1rbfo[uR] = nil
        end
      end
    end;
    tbl47[890] = function (num291, tbl171, value448, value449, value450, value451, value452, value453, value454)
      if num291._1rbfc then
        local num292 = value452;
        local num293 = num291._1rbfc._1rbfr;
        local tbl172 = {}
        local num294 = 0;
        for vg = num293 + 1, num292 == 0 and num291._1rbft or num293 + num292 - 1 do
          num294 = num294 + 1;
          tbl172[num294] = tbl171[vg]
        end;
        tbl172._1rbn = num294;
        num291._1rbfc._1rbar = tbl172
      end
    end;
    tbl47[921] = function (value455, value456, tbl173, value457, value458, value459, value460, value461, value462, value463)
      local num295 = value460;
      if num295 == 0 then
        tbl20[fn98(fn80(value458, num212))] = tbl173[value457]
      else fn24(value455._1rbfu, value458, tbl173[value457])
      end
    end;
    tbl47[bit32(30420, 29802)] = function (value464, value465, value466, value467, value468, value469, value470, value471, value472)
    end;
    tbl47[888] = function (...)
      local num296, tbl174, value473, num297, num298, value474, value475, value476, value477 =...
      if not (true) then
      local num299 = 9705
    end;
    local tbl175 = tbl46[num297 + 0 * 31 + 1]
    local tbl176 = tbl98[num298 + 1]
    if not tbl176 then
      fn37()
    end;
    local tbl177 = {}
    if tbl176.oka__xcqhrd and # tbl176.oka__xcqhrd > 0 then
      for vO = 1, # tbl176.oka__xcqhrd do
        local tbl178 = tbl176.oka__xcqhrd[vO]
        if tbl178[1] == 1 then
          local tbl179 = tbl178[2]
          local value478 = num296._1rbfo[tbl179]
          if not value478 then
            value478 = {1, tbl174, tbl179} num296._1rbfo[tbl179] = value478
          end;
          tbl177[vO - 1] = value478 else tbl177[vO - 1] = num296._1rbfu and num296._1rbfu[tbl178[2]] or nil
        end
      end
    end;
    tbl174[tbl175] = function (...)
      local value479 = select('#',...)
      local tbl180 = {...} tbl180[0] = value479;
      return fn22(tbl176, tbl180, tbl177)
    end
  end;
  tbl47[277] = function (value480, value481, tbl181, value482, value483, value484, value485, value486, value487, value488)
    local num300 = 2381;
    ;
    fn44(value481, value482, tbl181[value483])
  end;
  tbl47[485] = function (value489, value490, tbl182, value491, value492, value493, value494, value495, value496, value497) tbl182[value491] = tbl182[value492][tbl182[value493]]
  end;
  tbl47[462] = function (value498, tbl183, tbl184, ws, value499, value500, value501, value502, value503)
    if not (true) then
      local num301 = 36380
    end;
    local tbl185 = tbl46[ws + 0 * 32 + 1]
    local fn105 = tbl183[tbl185]
    local value504 = tbl183[tbl185 + 1]
    local value505 = tbl183[tbl185 + 2]
    local tbl186 = {fn105(value504, value505)}
    if tbl186[1] ~= nil then
      for wE = 1, value499 do
        tbl183[tbl185 + 2 + wE] = tbl186[wE]
      end;
      tbl183[tbl185 + 2] = tbl186[1]
    end;
    tbl184[value500] = tbl186[1]
  end;
  tbl47[bit32(4225, 5063)] = function (value506, value507, value508, num302, value509, value510, value511, value512, value513, value514)
    if not (true) then
      local num303 = 62028
    end;
    local tbl187 = tbl46[num302 + 3096 - 3095 + 45 - 45]
    for wR, wS in pairs(value506._1rbfo) do
      if wR >= tbl187 and wS[1] == 1 then
        wS[2] = wS[2][wS[3]] wS[1] = 0;
        wS[3] = nil;
        value506._1rbfo[wR] = nil
      end
    end
  end;
  tbl47[648] = function (value515, tbl188, value516, value517, value518, value519, value520, value521, value522)
    if value515._1rbfc then
      local num304 = value520;
      local num305 = value515._1rbfc._1rbfr;
      local tbl189 = value515._1rbfc._1rbrt or {_1rbn = 0}
      local num306 = tbl189._1rbn or # tbl189;
      if num304 == 0 then
        for xg = 1, num306 do
          tbl188[num305 + xg - 1] = tbl189[xg]
        end;
        for xh = num305 + num306, value515._1rbft do
          tbl188[xh] = nil
        end;
        value515._1rbft = num305 + num306 - 1
      else
        for xi = 1, num304 - 1 do
          tbl188[num305 + xi - 1] = tbl189[xi]
        end
      end;
      value515._1rbfc = nil
    end
  end;
  tbl47[bit32(26494, 26205)] = function (value523, value524, value525, value526, value527, value528, value529, value530, value531, value532)
  end;
  tbl47[678] = function (num307, value533, value534, value535, value536, value537, value538, value539, value540, value541)
    if num307._1rbfc and num307._1rbfc._1rbfn then
      local fn106 = num307._1rbfc._1rbfn;
      local value542 = num307._1rbfc._1rbar or {_1rbn = 0}
      local value543 = value542._1rbn or # value542;
      local fn107, fn108 = fn38(fn106(fn48(value542, 1, value543))) fn108._1rbn = fn107;
      num307._1rbfc._1rbrt = fn108
    end
  end;
  tbl47[297] = function (value544, value545, value546, num308, value547, value548, value549, value550, value551, value552)
    local value553 = bit32(num77, fn26(num308))
    local fn109 = fn46(value547, value553, 0) value544._1rbfb[num308 + 1][4] = fn109
  end;
  tbl47[bit32(9150, 8775)] = function (num309, tbl190, value554, num310, num311, value555, value556, value557, value558, value559)
    local num312 = 52971;
    if string.len("") == 1 then
      num312 = nil
    end;
    local tbl191 = tbl46[num310 + 1]
    local tbl192 = tbl190[tbl191]
    local num313 = num311 == 0 and num309._1rbft - tbl191 or num311;
    if num313 < 0 then
      num313 = 0
    end;
    local num314 = value555;
    for yj = 1, num313 do
      tbl192[num314 + yj] = tbl190[tbl191 + yj]
    end
  end;
  tbl47[755] = function (value560, value561, value562, value563, value564, value565, value566, value567, value568, value569)
  end;
  tbl47[86] = function (...)
    local value570, tbl193, value571, num315, num316, value572, value573, value574, value575 =...
    local tbl194 = tbl46[num315 + 2814 - 2813]
    local num317 = value570._1rbfpr.oka_julfo or 0;
    local num318 = (value570._1rbfag[0] or # value570._1rbfag) - num317;
    if num318 < 0 then
      num318 = 0
    end;
    if num316 == 0 then
      for yG = 1, num318 do
        tbl193[tbl194 + yG - 1] = value570._1rbfag[num317 + yG]
      end;
      if value570._1rbft >= tbl194 + num318 then
        for yH = tbl194 + num318, value570._1rbft do
          tbl193[yH] = nil
        end
      end;
      value570._1rbft = tbl194 + num318 - 1
    else
      for yI = 1, num316 - 1 do
        if yI <= num318 then
          tbl193[tbl194 + yI - 1] = value570._1rbfag[num317 + yI]
        else tbl193[tbl194 + yI - 1] = nil
        end
      end
    end
  end;
  tbl47[bit32(4405, 4469)] = function (value576, value577, value578, value579, value580, value581, value582, value583, value584, value585)
  end;
  tbl47[15] = function (value586, value587, tbl195, num319, value588, value589, value590, value591, value592)
    local flag5 = false;
    local num320 = value590;
    local value593 = value591;
    if tbl56[num320 + 1](tbl195[value588], tbl195[value589], tbl195[value593]) then
      if num319 > 0 then
        value586._1rbfp = num319 - 1;
        flag5 = true
      else value586._1rbfp = -1;
        flag5 = true
      end
    end;
    return flag5
  end;
  tbl47[bit32(16822, 16599)] = function (value594, tbl196, tbl197, num321, value595, value596, value597, value598, value599, value600)
    local tbl198 = tbl46[num321 + 0 * 32 + 1]
    local fn110 = tbl196[tbl198]
    local value601 = tbl196[tbl198 + 1]
    local value602 = tbl196[tbl198 + 2]
    local tbl199 = {fn110(value601, value602)}
    if tbl199[1] ~= nil then
      for zu = 1, value595 do
        tbl196[tbl198 + 2 + zu] = tbl199[zu]
      end;
      tbl196[tbl198 + 2] = tbl199[1]
    end;
    tbl197[value596] = tbl199[1]
  end;
  tbl47[bit32(5492, 5540)] = function (...)
    local value603, value604, tbl200, value605, value606, value607, value608, value609, value610 =...
    local num322 = value608;
    tbl200[value605] = tbl57[tbl58[num322 + 1]](fn98(fn80(value606, num212)), value606, fn23, value603._1rbfu)
  end;
  tbl47[bit32(4514, 4799)] = function (value611, value612, value613, value614, value615, value616, value617, value618, value619)
  end;
  tbl47[726] = function (value620, value621, value622, value623, value624, value625, value626, value627, value628)
    local num323 = 5125;
  end;
  tbl47[928] = function (value629, value630, value631, value632, value633, value634, value635, value636, value637, value638)
  end;
  tbl47[136] = function (...)
    local value639, tbl201, value640, num324, value641, value642, value643, value644, value645 =...
    local tbl202 = tbl46[num324 + 3453 - 3452 + 442 - 442]
    if not tbl201[tbl202] then
      fn37()
    end;
    value639._1rbfc = {_1rbfr = tbl202, _1rbfn = tbl201[tbl202]}
    local value646 = tbl82[value639._1rbfc._1rbfn]
    if value646 then
      value639._1rbfc._1rbfn = value646
    end
  end;
  tbl47[643] = function (...)
    local value647, value648, value649, value650, value651, value652, value653, value654, value655 =...
  end;
  tbl47[221] = function (value656, value657, tbl203, value658, value659, value660, value661, value662, value663, value664)
    local num325 = value661;
    if num325 == 0 then
      tbl20[fn98(fn80(value659, num212))] = tbl203[value658]
    else fn24(value656._1rbfu, value659, tbl203[value658])
    end
  end;
  tbl47[bit32(11491, 11350)] = function (value665, value666, tbl204, value667, value668, value669, value670, value671, value672)
    local num326 = value670;
    tbl204[value667] = tbl57[tbl58[num326 + 1]](fn98(fn80(value668, num212)), value668, fn23, value665._1rbfu)
  end;
  tbl47[88] = function (value673, value674, tbl205, value675, value676, value677, value678, value679, value680, value681)
    local num327 = value678;
    tbl205[value675] = tbl54[num327 + 1](tbl205[value676], tbl205[value677])
  end;
  tbl47[399] = function (...)
    local num328, tbl206, value682, value683, value684, value685, value686, value687, value688 =...
    if num328._1rbfc then
    local num329 = value686;
    local num330 = num328._1rbfc._1rbfr;
    local tbl207 = {}
    local num331 = 0;
    for Bv = num330 + 1, num329 == 0 and num328._1rbft or num330 + num329 - 1 do
      num331 = num331 + 1;
      tbl207[num331] = tbl206[Bv]
    end;
    tbl207._1rbn = num331;
    num328._1rbfc._1rbar = tbl207
  end
end;
tbl47[318] = function (...)
  local value689, tbl208, tbl209, num332, value690, value691, value692, value693, value694 =...
  local tbl210 = tbl46[num332 + 0 * 32 + 1]
  local fn111 = tbl208[tbl210]
  local value695 = tbl208[tbl210 + 1]
  local value696 = tbl208[tbl210 + 2]
  local tbl211 = {fn111(value695, value696)}
  if tbl211[1] ~= nil then
    for BK = 1, value690 do
      tbl208[tbl210 + 2 + BK] = tbl211[BK]
    end;
    tbl208[tbl210 + 2] = tbl211[1]
  end;
  tbl209[value691] = tbl211[1]
end;
tbl47[bit32(2106, 2686)] = function (...)
  local value697, value698, tbl212, value699, value700, value701, value702, value703, value704 =...tbl212[value699][tbl212[value700]] = tbl212[value701]
end;
tbl47[801] = function (value705, value706, tbl213, num333, value707, value708, value709, value710, value711, value712)
  local flag6 = false;
  local num334 = value709;
  local value713 = value710;
  if tbl56[num334 + 1](tbl213[value707], tbl213[value708], tbl213[value713]) then
    if num333 > 0 then
      value705._1rbfp = num333 - 1;
      flag6 = true else value705._1rbfp = -1;
      flag6 = true
    end
  end;
  return flag6
end;
tbl47[bit32(9236, 9775)] = function (value714, value715, tbl214, value716, value717, value718, value719, value720, value721) tbl214[value716][tbl214[value717]] = tbl214[value718]
end;
tbl47[828] = function (value722, value723, tbl215, value724, value725, value726, value727, value728, value729)
  if not (true) then
    local num335 = 49257
  end;
  tbl215[value724] = fn43(value723, value725)
end;
tbl47[955] = function (value730, value731, tbl216, value732, value733, value734, value735, value736, value737, value738) fn44(value731, value732, tbl216[value733])
end;
tbl47[334] = function (value739, value740, value741, value742, value743, value744, value745, value746, value747)
end;
tbl47[bit32(28397, 28189)] = function (value748, tbl217, value749, num336, num337, value750, value751, value752, value753, value754)
  local num338 = 50057;
  if math.floor(3.7) == 4 then
    num338 = nil
  end;
  fn40(value748._1rbfo)
  local tbl218 = tbl46[num336 + 1]
  if num337 == 0 then
    local tbl219 = {}
    local num339 = 0;
    for Dh = tbl218, value748._1rbft do
      num339 = num339 + 1;
      tbl219[num339] = tbl217[Dh]
    end;
    tbl219[0] = num339;
    return tbl219
  elseif num337 == 1 then
    local tbl220 = {} tbl220[0] = 0;
    return tbl220
  else
    local tbl221 = {}
    for Dk = 1, num337 - 1 do
      tbl221[Dk] = tbl217[tbl218 + Dk - 1]
    end;
    tbl221[0] = num337 - 1;
    return tbl221
  end
end;
tbl47[743] = function (value755, value756, value757, value758, value759, value760, value761, value762, value763)
end;
tbl47[651] = function (value764, tbl222, value765, num340, num341, value766, value767, value768, value769)
  local tbl223 = tbl46[num340 + 2814 - 2813]
  local num342 = value764._1rbfpr.oka_julfo or 0;
  local num343 = (value764._1rbfag[0] or # value764._1rbfag) - num342;
  if num343 < 0 then
    num343 = 0
  end;
  if num341 == 0 then
    for DG = 1, num343 do
      tbl222[tbl223 + DG - 1] = value764._1rbfag[num342 + DG]
    end;
    if value764._1rbft >= tbl223 + num343 then
      for DH = tbl223 + num343, value764._1rbft do
        tbl222[DH] = nil
      end
    end;
    value764._1rbft = tbl223 + num343 - 1
  else
    for DI = 1, num341 - 1 do
      if DI <= num343 then
        tbl222[tbl223 + DI - 1] = value764._1rbfag[num342 + DI]
      else tbl222[tbl223 + DI - 1] = nil
      end
    end
  end
end;
tbl47[789] = function (...)
  local num344, tbl224, value770, num345, num346, value771, value772, value773, value774 =...
  if not (true) then
  local num347 = 49416
end;
local tbl225 = tbl46[num345 + 1]
local tbl226 = tbl224[tbl225]
local num348 = num346 == 0 and num344._1rbft - tbl225 or num346;
if num348 < 0 then
  num348 = 0
end;
local num349 = value771;
for DX = 1, num348 do
  tbl226[num349 + DX] = tbl224[tbl225 + DX]
end
end;
tbl47[607] = function (value775, value776, tbl227, value777, value778, value779, value780, value781, value782)
  local num350 = value780;
  tbl227[value777] = tbl54[num350 + 1](tbl227[value778], tbl227[value779])
end;
tbl47[13] = function (...)
  local value783, tbl228, value784, num351, num352, value785, value786, value787, value788 =...fn40(value783._1rbfo)
  local tbl229 = tbl46[num351 + 1]
  if num352 == 0 then
    local tbl230 = {}
    local num353 = 0;
    for Eu = tbl229, value783._1rbft do
      num353 = num353 + 1;
      tbl230[num353] = tbl228[Eu]
    end;
    tbl230[0] = num353;
    return tbl230 elseif num352 == 1 then
    local tbl231 = {} tbl231[0] = 0;
    return tbl231 else
    local tbl232 = {}
    for Ex = 1, num352 - 1 do
      tbl232[Ex] = tbl228[tbl229 + Ex - 1]
    end;
    tbl232[0] = num352 - 1;
    return tbl232
  end
end;
tbl47[bit32(5991, 5193)] = function (...)
  local value789, tbl233, value790, value791, value792, value793, value794, value795, value796 =...
  if value789._1rbfc then
  local num354 = value794;
  local num355 = value789._1rbfc._1rbfr;
  local tbl234 = value789._1rbfc._1rbrt or {_1rbn = 0}
  local num356 = tbl234._1rbn or # tbl234;
  if num354 == 0 then
    for EL = 1, num356 do
      tbl233[num355 + EL - 1] = tbl234[EL]
    end;
    for EM = num355 + num356, value789._1rbft do
      tbl233[EM] = nil
    end;
    value789._1rbft = num355 + num356 - 1 else
    for EN = 1, num354 - 1 do
      tbl233[num355 + EN - 1] = tbl234[EN]
    end
  end;
  value789._1rbfc = nil
end
end;
tbl47[717] = function (...)
  local value797, value798, tbl235, value799, value800, value801, value802, value803, value804 =...fn44(value798, value799, tbl235[value800])
end;
tbl47[bit32(19138, 19384)] = function (value805, tbl236, value806, num357, num358, value807, value808, value809, value810) fn40(value805._1rbfo)
  local tbl237 = tbl46[num357 + 1]
  if num358 == 0 then
    local tbl238 = {}
    local num359 = 0;
    for Fj = tbl237, value805._1rbft do
      num359 = num359 + 1;
      tbl238[num359] = tbl236[Fj]
    end;
    tbl238[0] = num359;
    return tbl238
  elseif num358 == 1 then
    local tbl239 = {} tbl239[0] = 0;
    return tbl239
  else
    local tbl240 = {}
    for Fm = 1, num358 - 1 do
      tbl240[Fm] = tbl236[tbl237 + Fm - 1]
    end;
    tbl240[0] = num358 - 1;
    return tbl240
  end
end;
tbl47[668] = function (value811, tbl241, value812, value813, value814, value815, value816, value817, value818)
  if value811._1rbfc then
    local num360 = value816;
    local num361 = value811._1rbfc._1rbfr;
    local tbl242 = value811._1rbfc._1rbrt or {_1rbn = 0}
    local num362 = tbl242._1rbn or # tbl242;
    if num360 == 0 then
      for FA = 1, num362 do
        tbl241[num361 + FA - 1] = tbl242[FA]
      end;
      for FB = num361 + num362, value811._1rbft do
        tbl241[FB] = nil
      end;
      value811._1rbft = num361 + num362 - 1
    else
      for FC = 1, num360 - 1 do
        tbl241[num361 + FC - 1] = tbl242[FC]
      end
    end;
    value811._1rbfc = nil
  end
end;
tbl47[499] = function (value819, value820, tbl243, value821, value822, value823, value824, value825, value826, value827) tbl243[value821] = fn43(value820, value822)
end;
tbl47[bit32(26110, 26180)] = function (...)
  local value828, value829, tbl244, value830, value831, value832, value833, value834, value835 =...
  local num363 = value833;
  tbl244[value830] = tbl54[num363 + 1](tbl244[value831], tbl244[value832])
end;
tbl47[400] = function (value836, value837, tbl245, value838, value839, value840, value841, value842, value843, value844) tbl245[value838] = tbl245[value839][tbl245[value840]]
end;
tbl47[bit32(3968, 3237)] = function (value845, value846, tbl246, value847, value848, value849, value850, value851, value852)
  local num364 = value850;
  tbl246[value847] = tbl55[num364 + 1](tbl246[value848])
end;
local tbl247 = {1181333551, 1636108209, 2231589772, 2262836627}
local tbl248 = {17, 8, 11, 0}
local num365 = 0;
local num366 = 54;
local num367 = 12266853;
local tbl249 = {[12266853] = {0, 8, 8494876, false}, [8494876] = {9, 16, 5710633, false}, [5710633] = {17, 27, 14656933, false}, [14656933] = {28, 33, 14656933, false}, [2916402] = {-1,-1, 12266853, true}, [1602121] = {-1,-1, 5710633, true}}
local tbl250 = {}
for Gy, Gz in next, tbl249 do
  if not Gz[4] then
    for GA = Gz[1], Gz[2] do
      tbl250[GA] = Gy
    end
  end
end;
local
function fn112(num368)
  local tbl251 = tbl249[num367]
  if not tbl251 then
    num367 = -1;
    return
  end;
  if tbl251[4] then
    num367 = tbl251[3]
    return
  end;
  local tbl252 = tbl250[num368]
  if tbl252 and tbl252 ~= num367 then
    num367 = tbl252;
    return
  end;
  if num368 > tbl251[2] then
    num367 = tbl251[3]
  end
end;
fn22 = function (value853, tbl253, value854, num369)
  local tbl254 = {}
  local tbl255 = {}
  if not num369 and not value853.oka__vawp then
    if value853.okamrvts ~= (function (value855)
        local tbl256 = value855.oka___lxpfyq;
        local num370 = # tbl256;
        local num371 = value855.oka_julfo or 0;
        local num372 = value855.oka__xcqhrd and # value855.oka__xcqhrd or 0;
        local num373 = 2918524760;
        num373 = fn14(num373 * 2000003 + num370) num373 = fn14(num373 * 2000003 + num371) num373 = fn14(num373 * 2000003 + num372) num373 = fn14(num373 * 1500007 + num79) num373 = fn14(num373 * 1500007 + num76)
        for GR = 1, num370 do
          local tbl257 = tbl256[GR] num373 = fn14(num373 * 2000003 + (tbl257[4] or 0) + 1) num373 = fn14(num373 * 2000003 + (tbl257[2] or 0) + 1) num373 = fn14(num373 * 2000003 + (tbl257[5] or 0) + 1) num373 = fn14(num373 * 2000003 + (tbl257[6] or 0) + 1)
        end;
        return num373
      end)(value853) then
      error("attempt to get length of a nil value")
    end;
    value853.oka__vawp = true
  end;
  for GT = 1, value853.oka_julfo do
    tbl254[GT - 1] = tbl253[GT]
  end;
  local tbl258 = value853.oka___lxpfyq;
  local num374 = # tbl258;
  local tbl259 = value853.oka__juyg;
  if not tbl259 then
    tbl259 = {} value853.oka__juyg = tbl259
  end;
  local tbl260 = value853.oka_ipyvh;
  if not tbl260 then
    tbl260 = {} value853.oka_ipyvh = tbl260
  end;
  local tbl261 = value853.oka__lnkdhk;
  if not tbl261 then
    tbl261 = {} value853.oka__lnkdhk = tbl261
  end;
  local tbl262 = {_1rbfp = value853.oka_ffciu, _1rbft = -1, _1rbfo = {}, _1rbfc = nil, _1rbfb = tbl258, _1rbfu = value854, _1rbfpr = value853, _1rbfag = tbl253}
  if value853.oka__tswz then
    local tbl263 = {}
    while tbl262._1rbfp >= 0 and tbl262._1rbfp < num374 do
      local tbl264 = tbl263[tbl262._1rbfp]
      if not tbl264 then
        local tbl265 = tbl258[tbl262._1rbfp + 0 * 32 + 1]
        local num375 = tbl260[tbl262._1rbfp]
        if num375 == nil then
          num375 = bit32(num77, bit32(tbl48[tbl262._1rbfp % 256 + 1], (fn118(tbl262._1rbfp / 256) * 1237146503 + 3335061875) % 4294967296)) tbl260[tbl262._1rbfp] = num375
        end;
        local tbl266 = tbl262._1rbfp * 4;
        local num376 = tbl261[tbl266]
        if num376 == nil then
          num376 = fn47(num375, 0) tbl261[tbl266] = num376
        end;
        local num377 = tbl261[tbl266 + 2727 - 2726]
        if num377 == nil then
          num377 = fn47(num375, 1) tbl261[tbl266 + 988 - 987 + 856 - 856] = num377
        end;
        local num378 = tbl261[tbl266 + 1305 - 1303]
        if num378 == nil then
          num378 = fn47(num375, 2) tbl261[tbl266 + 258 - 256] = num378
        end;
        local num379 = tbl261[tbl266 + 3]
        if num379 == nil then
          num379 = fn47(num375, 3) tbl261[tbl266 + 2118 - 2115] = num379
        end;
        local num380 = bit32(tbl265[4] % 65536, num376) % 65536;
        local value856 = tbl265[1]
        local tbl267 = tbl50[num380] and 1;
        local value857 = bit32(tbl265[6] % 65536, num379) % 65536;
        local value858 = bit32(tbl265[5] % 65536, num378) % 65536;
        local value859 = bit32(tbl265[2] % 65536, num377) % 65536;
        local tbl268 = tbl262._1rbfp * 2;
        local num381 = tbl259[tbl268]
        if num381 == nil then
          num381 = fn46(tbl265[7], num375, 0) tbl259[tbl268] = num381
        end;
        local num382 = tbl259[tbl268 + 1]
        if num382 == nil then
          num382 = fn46(tbl265[3], num375, 1) tbl259[tbl268 + 1] = num382
        end;
        local tbl269 = tbl47[bit32(tbl19[num380], (num380 * 48129 + 49358) % 65521 * 30557 % 65536) - num174] tbl264 = {num380, value856, tbl267, value859, value858, value857, num381, num382, num375, tbl269} tbl263[tbl262._1rbfp] = tbl264
      end;
      if tbl264[3] == 1 then
        local tbl270 = tbl264[2]
        local tbl271 = tbl264[9]
        if tbl270 == 65535 then
          tbl262._1rbfp = -1
        else tbl262._1rbfp = fn46(tbl270, tbl271, 3)
        end
      else
        local tbl272 = tbl264[10]
        if tbl272 then
          local tbl273 = tbl272(tbl262, tbl254, tbl255, tbl264[4], tbl264[5], tbl264[6], tbl264[7], tbl264[8], tbl264[9])
          if type(tbl273) == 'table' then
            return fn48(tbl273, 1, tbl273[0])
          end;
          if not tbl273 then
            local tbl274 = tbl264[2]
            local tbl275 = tbl264[9]
            if tbl274 == 65535 then
              tbl262._1rbfp = -1
            else tbl262._1rbfp = fn46(tbl274, tbl275, 3)
            end
          end
        else
          local tbl276 = tbl264[2]
          local tbl277 = tbl264[9]
          if tbl276 == 65535 then
            tbl262._1rbfp = -1
          else tbl262._1rbfp = fn46(tbl276, tbl277, 3)
          end
        end
      end
    end;
    return nil
  end;
  while tbl262._1rbfp >= 0 and tbl262._1rbfp < num374 and num367 ~= -1 do
    if num369 then
      num365 = num365 + 1;
      if num365 >= 54 then
        num365 = 0;
        local tbl278 = tbl262._1rbfp * 3471 % 4 + 1;
        local tbl279 = tbl248[tbl278]
        local num383 = 2166136261;
        for HE = tbl279, tbl279 + 15 do
          local tbl280 = tbl30[HE + 1]
          if tbl280 then
            num383 = bit32(num383, tbl280[2] or 0) num383 = fn14(fn12(fn118(num383 / 65536) * 16777619) * 65536 + fn12(num383) * 16777619) num383 = bit32(num383, tbl280[5] or 0) num383 = fn14(fn12(fn118(num383 / 65536) * 16777619) * 65536 + fn12(num383) * 16777619) num383 = bit32(num383, tbl280[6] or 0) num383 = fn14(fn12(fn118(num383 / 65536) * 16777619) * 65536 + fn12(num383) * 16777619) num383 = bit32(num383, tbl280[1] or 0) num383 = fn14(fn12(fn118(num383 / 65536) * 16777619) * 65536 + fn12(num383) * 16777619)
          end
        end;
        if num383 ~= tbl247[tbl278] then
          num77 = 720838682;
          error("", 0)
        end;
        local num384 = 0;
        if value128 then
          local num385, num386 = pcall(num3.info, fn59, "l")
          local num387, num388 = pcall(num3.info, fn60, "l")
          if num385 and num387 then
            num384 = (num386 or 0) - (num388 or 0)
          end
        end;
        local value860 = tbl79[1] num77 = fn14(num77 + (num384 + num211) * 708293255)
      end
    end;
    local tbl281 = tbl258[tbl262._1rbfp + 1]
    local num389 = tbl260[tbl262._1rbfp]
    if num389 == nil then
      num389 = bit32(num77, bit32(tbl48[tbl262._1rbfp % 256 + 1], (fn118(tbl262._1rbfp / 256) * 1237146503 + 3335061875) % 4294967296)) tbl260[tbl262._1rbfp] = num389
    end;
    local tbl282 = tbl262._1rbfp * 4;
    local num390 = tbl261[tbl282]
    if num390 == nil then
      num390 = fn47(num389, 0) tbl261[tbl282] = num390
    end;
    local num391 = tbl261[tbl282 + 2727 - 2726]
    if num391 == nil then
      num391 = fn47(num389, 1) tbl261[tbl282 + 988 - 987 + 856 - 856] = num391
    end;
    local num392 = tbl261[tbl282 + 1305 - 1303]
    if num392 == nil then
      num392 = fn47(num389, 2) tbl261[tbl282 + 258 - 256] = num392
    end;
    local num393 = tbl261[tbl282 + 3]
    if num393 == nil then
      num393 = fn47(num389, 3) tbl261[tbl282 + 2118 - 2115] = num393
    end;
    local num394 = bit32(tbl281[4] % 65536, num390) % 65536;
    local num395 = tbl281[1]
    if tbl50[num394] then
      if num369 then
        if num395 == 65535 then
          tbl262._1rbfp = -1
        else
          local fn113 = fn46(num395, num389, 3)
          if not fn49(fn113) then
            error("", 0)
          end;
          tbl262._1rbfp = fn113
        end
      else
        if num395 == 65535 then
          tbl262._1rbfp = -1
        else tbl262._1rbfp = fn46(num395, num389, 3)
        end
      end
    else
      local value861 = bit32(tbl281[6] % 65536, num393) % 65536;
      local value862 = bit32(tbl281[5] % 65536, num392) % 65536;
      local value863 = bit32(tbl281[2] % 65536, num391) % 65536;
      local tbl283 = tbl262._1rbfp * 2;
      local num396 = tbl259[tbl283]
      if num396 == nil then
        num396 = fn46(tbl281[7], num389, 0) tbl259[tbl283] = num396
      end;
      local num397 = tbl259[tbl283 + 1]
      if num397 == nil then
        num397 = fn46(tbl281[3], num389, 1) tbl259[tbl283 + 1] = num397
      end;
      local tbl284 = tbl47[bit32(tbl19[num394], (num394 * 48129 + 49358) % 65521 * 30557 % 65536) - num174]
      if tbl284 then
        local tbl285 = tbl284(tbl262, tbl254, tbl255, value863, value862, value861, num396, num397, num389)
        if type(tbl285) == 'table' then
          return fn48(tbl285, 1, tbl285[0])
        end;
        if not tbl285 then
          if num369 then
            if num395 == 65535 then
              tbl262._1rbfp = -1
            else
              local fn114 = fn46(num395, num389, 3)
              if not fn49(fn114) then
                error("", 0)
              end;
              tbl262._1rbfp = fn114
            end
          else
            if num395 == 65535 then
              tbl262._1rbfp = -1
            else tbl262._1rbfp = fn46(num395, num389, 3)
            end
          end
        end
      else
        if num369 then
          if num395 == 65535 then
            tbl262._1rbfp = -1
          else
            local fn115 = fn46(num395, num389, 3)
            if not fn49(fn115) then
              error("", 0)
            end;
            tbl262._1rbfp = fn115
          end
        else
          if num395 == 65535 then
            tbl262._1rbfp = -1
          else tbl262._1rbfp = fn46(num395, num389, 3)
          end
        end
      end
    end;
    if num369 then
      fn112(tbl262._1rbfp)
    end
  end;
  return nil
end;
return fn22({oka___lxpfyq = tbl30, oka_ffciu = 32, oka_julfo = 0, oka__xcqhrd = {}, okamrvts = 2250039739}, {[0] = 0}, nil, true)
end)(...)
