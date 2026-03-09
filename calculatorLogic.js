// calculatorLogic.js

export const StatsLogic = {
    calcTotalAcc: (dex, luk, extraAcc) => Math.floor(dex * 0.6 + luk * 0.3) + (parseFloat(extraAcc) || 0),
    calcTotalAtk: (atkParts) => Object.values(atkParts).reduce((sum, val) => sum + (parseFloat(val) || 0), 0),
    calcTotalExtraAcc: (extraAcc) => Object.values(extraAcc).reduce((sum, val) => sum + (parseFloat(val) || 0), 0),
    levelUp: (char, autoDist) => {
        if (autoDist.luk + autoDist.dex + autoDist.str > 5) throw new Error("點數總和不能超過 5！");
        return {
            ...char,
            level: char.level + 1,
            luk: char.luk + autoDist.luk,
            dex: char.dex + autoDist.dex,
            str: char.str + autoDist.str,
        };
    },
    levelDown: (char, autoDist) => {
        if (char.level <= 1) return char;
        return {
            ...char,
            level: char.level - 1,
            luk: Math.max(4, char.luk - autoDist.luk),
            dex: Math.max(4, char.dex - autoDist.dex),
            str: Math.max(4, char.str - autoDist.str),
        };
    }
};

export const MathLogic = {
    normDistCDF: (x, mean, sd) => {
        if (sd === 0) return x <= mean ? 1 : 0;
        let z = (x - mean) / sd;
        let sign = z < 0 ? -1 : 1;
        z = Math.abs(z) / Math.sqrt(2.0);
        let t = 1.0 / (1.0 + 0.3275911 * z);
        let y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
        return 0.5 * (1.0 + sign * y);
    }
};

export const BattleLogic = {
    calcDamageMetrics: (char, mob, config) => {
        const { totalAtk: atk, totalAcc } = char;
        const lvDiff = Math.max(0, mob.level - char.level);
        const reqHit = (mob.avoid * (55 + 2 * lvDiff)) / 15;
        const halfReq = reqHit / 2;

        let p_hit = totalAcc >= reqHit ? 1 : totalAcc <= halfReq ? 0 : (totalAcc - halfReq) / halfReq;
        const actualHitRate = Math.max(0, Math.min(1, p_hit));

        const levelMult = 1 - 0.01 * lvDiff;
        const baseStatMax = Math.floor((5.25 * char.luk * atk) / 100);
        const baseStatMin = Math.floor((2.625 * char.luk * atk) / 100);
        const rawMax = baseStatMax * levelMult - mob.def * 0.55;
        const rawMin = baseStatMin * levelMult - mob.def * 0.55;

        const skillMult = char.skillPower / 100;
        const critSkillMult = (char.skillPower + char.critExtraDmg) / 100;

        const NC_lo = Math.max(0, Math.floor(rawMin * skillMult));
        const NC_hi = Math.max(1, Math.floor(rawMax * skillMult));
        const C_lo = Math.max(0, Math.floor(rawMin * critSkillMult));
        const C_hi = Math.max(1, Math.floor(rawMax * critSkillMult));

        const p_crit = (char.critRate || 0) / 100;
        const n = char.hits || 1;

        let shadow_NC_lo = 0, shadow_NC_hi = 0, shadow_C_lo = 0, shadow_C_hi = 0;
        let shadow_mu_success = 0, shadow_var_success = 0;

        if (config.useShadowPartner) {
            const sp_ratio = config.shadowPartnerDmg / 100;
            shadow_NC_lo = Math.floor(NC_lo * sp_ratio);
            shadow_NC_hi = Math.floor(NC_hi * sp_ratio);
            shadow_C_lo = Math.floor(C_lo * sp_ratio);
            shadow_C_hi = Math.floor(C_hi * sp_ratio);

            shadow_mu_success = (1 - p_crit) * ((shadow_NC_lo + shadow_NC_hi) / 2) + p_crit * ((shadow_C_lo + shadow_C_hi) / 2);
            shadow_var_success = (1 - p_crit) * (Math.pow(shadow_NC_hi - shadow_NC_lo, 2) / 12) +
                                 p_crit * (Math.pow(shadow_C_hi - shadow_C_lo, 2) / 12) +
                                 p_crit * (1 - p_crit) * Math.pow((shadow_C_lo + shadow_C_hi) / 2 - (shadow_NC_lo + shadow_NC_hi) / 2, 2);
        }

        const main_mu_success = (1 - p_crit) * ((NC_lo + NC_hi) / 2) + p_crit * ((C_lo + C_hi) / 2);
        const main_var_success = (1 - p_crit) * (Math.pow(NC_hi - NC_lo, 2) / 12) +
                                 p_crit * (Math.pow(C_hi - C_lo, 2) / 12) +
                                 p_crit * (1 - p_crit) * Math.pow((C_lo + C_hi) / 2 - (NC_lo + NC_hi) / 2, 2);

        const total_mu_success_per_hit = main_mu_success + shadow_mu_success;
        const total_var_success_per_hit = main_var_success + shadow_var_success;

        const mu_actual_per_hit = actualHitRate * total_mu_success_per_hit;
        const var_actual_per_hit = actualHitRate * total_var_success_per_hit +
                                   actualHitRate * (1 - actualHitRate) * Math.pow(total_mu_success_per_hit, 2);

        const mean_total = n * mu_actual_per_hit;
        const sd = Math.sqrt(n * var_actual_per_hit);

        return {
            displayTotalNoCritMin: (NC_lo + shadow_NC_lo) * n,
            displayTotalNoCritMax: (NC_hi + shadow_NC_hi) * n,
            displayTotalAllCritMin: (C_lo + shadow_C_lo) * n,
            displayTotalAllCritMax: (C_hi + shadow_C_hi) * n,
            NC_lo, NC_hi, C_lo, C_hi,
            shadow_NC_lo, shadow_NC_hi, shadow_C_lo, shadow_C_hi,
            mu_actual_per_hit, var_actual_per_hit, mean_total, sd,
            p_crit, n, actualHitRate
        };
    },

    getNormalApproximationProbs: (hp, dmg) => {
        if (dmg.actualHitRate <= 0 || dmg.mean_total <= 0) return "0";
        let prob1 = dmg.sd === 0 ? (hp <= dmg.mean_total ? 1 : 0) : 1 - MathLogic.normDistCDF(hp, dmg.mean_total, dmg.sd);
        prob1 = Math.max(0, Math.min(1, prob1));
        if (prob1 >= 0.999) return "100";

        let probs = [(prob1 * 100).toFixed(2)];
        let currentCumP = prob1;
        let castTimes = 2;

        while (currentCumP < 0.999 && castTimes <= 10) {
            const current_n = dmg.n * castTimes;
            const current_mean = current_n * dmg.mu_actual_per_hit;
            const current_sd = Math.sqrt(current_n * dmg.var_actual_per_hit);
            let p_n = current_sd === 0
                ? (hp <= current_mean ? 1 : 0)
                : 1 - MathLogic.normDistCDF(hp, current_mean, current_sd);
            p_n = Math.max(currentCumP, Math.min(1, p_n));
            probs.push((p_n * 100).toFixed(2));
            currentCumP = p_n;
            castTimes++;
        }
        if (currentCumP < 0.999) probs.push("100.00");
        return probs.join(", ");
    },

    getMonteCarloProbs: (hp, dmg, config) => {
        if (dmg.actualHitRate <= 0) return "0";
        const iterations = config.mcIterations || 10000;
        let cumulativeKills = new Array(11).fill(0);

        for (let i = 0; i < iterations; i++) {
            let hpLeft = hp;
            let casts = 0;
            while (hpLeft > 0 && casts < 10) {
                casts++;
                let castDamage = 0;
                for (let h = 0; h < dmg.n; h++) {
                    if (Math.random() <= dmg.actualHitRate) {
                        castDamage += (Math.random() < dmg.p_crit)
                            ? Math.floor(Math.random() * (dmg.C_hi - dmg.C_lo + 1)) + dmg.C_lo
                            : Math.floor(Math.random() * (dmg.NC_hi - dmg.NC_lo + 1)) + dmg.NC_lo;

                        if (config.useShadowPartner) {
                            castDamage += (Math.random() < dmg.p_crit)
                                ? Math.floor(Math.random() * (dmg.shadow_C_hi - dmg.shadow_C_lo + 1)) + dmg.shadow_C_lo
                                : Math.floor(Math.random() * (dmg.shadow_NC_hi - dmg.shadow_NC_lo + 1)) + dmg.shadow_NC_lo;
                        }
                    }
                }
                hpLeft -= castDamage;
                if (hpLeft <= 0) {
                    for (let c = casts; c <= 10; c++) cumulativeKills[c]++;
                    break;
                }
            }
        }

        let probs = [];
        for (let c = 1; c <= 10; c++) {
            let prob = cumulativeKills[c] / iterations;
            probs.push((prob * 100).toFixed(2));
            if (prob >= 0.999) break;
        }
        return probs.join(", ");
    },

    evaluateSingleStage: (stage, charState, config) => {
        const dmg = BattleLogic.calcDamageMetrics(charState, stage, config);

        if (dmg.actualHitRate <= 0) {
            return { ...stage, dmg, probString: "0.00", expectedHits: 9999, expPerHit: 0 };
        }
        // 如果期望打擊次數超過 10，且機率分布非常分散（例如有超過 10 個不同的機率值），則直接提示打太久了
        if (stage.hp > dmg.mean_total * 10) {
            const expectedHits = stage.hp / dmg.mean_total;
            return {
                ...stage,
                dmg,
                probString: "打太久了，換隻怪吧？",
                expectedHits,
                expPerHit: stage.exp / expectedHits
            };
        }

        const probStr = config.isMonteCarlo
            ? BattleLogic.getMonteCarloProbs(stage.hp, dmg, config)
            : BattleLogic.getNormalApproximationProbs(stage.hp, dmg);

        const pArr = probStr.split(", ").map((v) => parseFloat(v) / 100);

        let expectedHits = pArr.reduce((acc, p, i, arr) => {
            const prevP = i === 0 ? 0 : arr[i - 1];
            const exactP = Math.max(0, p - prevP);
            return acc + (i + 1) * exactP;
        }, 0);

        if (expectedHits <= 0) expectedHits = 9999;
        if (expectedHits > 10) expectedHits = stage.hp / dmg.mean_total;
        expectedHits = Math.max(1, expectedHits);

        return { ...stage, dmg, probString: probStr, expectedHits, expPerHit: stage.exp / expectedHits };
    },

    evaluateMob: (mob, charState, config) => {
        // 如果怪物具有 `stages` 屬性 (陣列)，進入多階段 FP 計算模式
        if (mob.stages && Array.isArray(mob.stages) && mob.stages.length > 0) {

            // 1. Map: 將每個階段分別丟進公式計算，得到每一階的獨立結果
            const evaluatedStages = mob.stages.map(stage =>
                BattleLogic.evaluateSingleStage({ ...mob, ...stage }, charState, config)
            );

            // 2. Reduce: 加總所有的期望次數與總經驗值
            const totalExpectedHits = evaluatedStages.reduce((sum, res) => sum + res.expectedHits, 0);
            const totalExp = evaluatedStages.reduce((sum, res) => sum + (res.exp || 0), 0);

            // 3. 組合 UI 顯示字串 (把每一階的機率串起來，例如： [一階] 100% | [二階] 22%, 83%)
            const combinedProbString = evaluatedStages.length > 1? evaluatedStages
                .map((res, index) => `[階${index + 1}] ${res.probString}`)
                .join(" ｜ "): evaluatedStages[0].probString;

            // 取最後一個階段的傷害作為面板顯示 (通常本體的傷害數字比較有參考價值)
            const finalStageDmg = evaluatedStages[evaluatedStages.length - 1].dmg;

            return {
                ...mob,
                dmg: finalStageDmg,
                exp: totalExp, // 總經驗值
                expectedHits: totalExpectedHits, // 總期望打擊次數
                expPerHit: totalExp / totalExpectedHits, // 最終綜合效益
                probString: combinedProbString
            };
        }

        // 如果是一般單階段怪物，直接呼叫
        return BattleLogic.evaluateSingleStage(mob, charState, config);
    }
};